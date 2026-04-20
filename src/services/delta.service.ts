import axios from "axios";
import crypto from "crypto";

const DELTA_BASE_URL = "https://api.delta.exchange";

export class DeltaService {
  /**
   * Generates a signature for Delta Exchange API requests.
   * Format: METHOD + TIMESTAMP + PATH + QUERY + BODY
   */
  private static generateSignature(
    method: string,
    timestamp: string,
    path: string,
    query: string = "",
    body: string = "",
    apiSecret: string
  ): string {
    const signatureString = method.toUpperCase() + timestamp + path + query + body;
    return crypto
      .createHmac("sha256", apiSecret)
      .update(signatureString)
      .digest("hex");
  }

  /**
   * Verifies the provided API credentials by attempting to fetch wallet balances.
   */
  static async verifyCredentials(
    apiKey: string,
    apiSecret: string,
  ): Promise<{ isValid: boolean; error?: string }> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = "/v2/wallet/balances";
    const method = "GET";

    const signature = this.generateSignature(
      method,
      timestamp,
      path,
      "",
      "",
      apiSecret,
    );

    try {
      const response = await axios.get(`${DELTA_BASE_URL}${path}`, {
        headers: {
          "api-key": apiKey,
          signature: signature,
          timestamp: timestamp,
          "Content-Type": "application/json",
          "User-Agent": "TradeDiary/1.0", // Mandatory for Delta Exchange
        },
      });

      // If we get an OK response, the credentials are valid
      return { isValid: response.status === 200 };
    } catch (error: any) {
      let errorMessage = "Verification failed. Please check your API Key/Secret.";

      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        // Log for server-side debugging
        console.error("❌ Delta API Error (Verification) Full Error:", JSON.stringify(error.response.data, null, 2));

        // Handle specific IP whitelist errors
        if (status === 403 || status === 401) {
          // Robust message extraction (handles strings and objects)
          let deltaMsg = "";
          if (typeof data?.message === "string") {
            deltaMsg = data.message;
          } else if (typeof data?.error === "string") {
            deltaMsg = data.error;
          } else if (data?.error?.code && typeof data.error.code === "string") {
            deltaMsg = data.error.code;
          }

          if (
            deltaMsg.toLowerCase().includes("whitelist") ||
            deltaMsg.toLowerCase().includes("ip") ||
            deltaMsg.toLowerCase().includes("access denied")
          ) {
            errorMessage = `Delta Exchange Error: ${deltaMsg}. Please ensure your server IP is whitelisted in Delta API settings.`;
          } else if (
            deltaMsg === "invalid_api_key_or_signature" ||
            deltaMsg === "invalid_api_key"
          ) {
            errorMessage = "Invalid API Key or Secret. Please double-check your credentials in Delta settings.";
          }
        }
      } else {
        console.error("❌ Delta Verification Network Error:", error.message);
        errorMessage = "Network error while connecting to Delta Exchange. Please try again.";
      }

      return { isValid: false, error: errorMessage };
    }
  }

  /**
   * Fetches trade fills from the last 30 days, groups them by Order ID,
   * and maps them to the Trade model structure.
   */
  static async getFillsAndMapToTrades(apiKey: string, apiSecret: string, clerkId: string) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = "/v2/fills";
    const method = "GET";

    // We want fills from the last 30 days
    const startTime = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const query = `?start_time=${startTime}&page_size=100`;

    const signature = this.generateSignature(method, timestamp, path, query, "", apiSecret);

    try {
      const response = await axios.get(`${DELTA_BASE_URL}${path}${query}`, {
        headers: {
          "api-key": apiKey,
          "signature": signature,
          "timestamp": timestamp,
          "Content-Type": "application/json",
          "User-Agent": "TradeDiary/1.0",
        },
      });

      if (!response.data || !response.data.success) {
        throw new Error("Failed to fetch fills from Delta Exchange");
      }

      const fills = response.data.result || [];

      // Grouping fills by order_id to treat multiple executions of the same order as one trade
      const groupedOrders: Record<string, any> = {};

      fills.forEach((fill: any) => {
        const orderId = fill.order_id;
        if (!groupedOrders[orderId]) {
          groupedOrders[orderId] = {
            order_id: orderId,
            symbol: fill.product_symbol,
            side: fill.side,
            totalSize: 0,
            totalCost: 0,
            earliestTimestamp: fill.created_at,
          };
        }

        const size = parseFloat(fill.size);
        const price = parseFloat(fill.price);

        groupedOrders[orderId].totalSize += size;
        groupedOrders[orderId].totalCost += size * price;
        // Use the earliest fill time as the entry time
        if (fill.created_at < groupedOrders[orderId].earliestTimestamp) {
          groupedOrders[orderId].earliestTimestamp = fill.created_at;
        }
      });

      // Map grouped data to the application's Trade schema
      return Object.values(groupedOrders).map((order: any) => {
        const avgPrice = order.totalCost / order.totalSize;
        // Delta timestamp is in microseconds, convert to milliseconds for Date object
        const entryDateObj = new Date(parseInt(order.earliestTimestamp) / 1000);
        const entryDate = entryDateObj.toISOString().split("T")[0];
        const entryTime = entryDateObj.toISOString().split("T")[1].substring(0, 5);

        return {
          clerkId,
          symbol: order.symbol,
          marketType: "Crypto",
          direction: order.side.toUpperCase() === "BUY" ? "LONG" : "SHORT",
          duration: "INTRADAY",
          entryDate,
          entryTime,
          entryPrice: avgPrice,
          quantity: order.totalSize,
          outcome: "PENDING",
          externalOrderId: order.order_id,
          externalBroker: "delta",
        };
      });
    } catch (error: any) {
      if (error.response) {
        console.error("❌ Delta API Error (Fills) Full Error:", JSON.stringify(error.response.data, null, 2));
        throw new Error(error.response.data?.error || "Failed to fetch trades from Delta Exchange");
      }
      throw error;
    }
  }
}
