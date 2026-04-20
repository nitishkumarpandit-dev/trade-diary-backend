import axios from "axios";
import crypto from "crypto";

const DELTA_BASE_URL = "https://api.india.delta.exchange";

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
   * Fetches trade data from the last 7 days and pairs entries/exits using FIFO.
   */
  static async getFillsAndMapToTrades(apiKey: string, apiSecret: string, clerkId: string) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const startTime = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    
    // 1. Fetch Fills (Executions)
    const fillsPath = "/v2/fills";
    const fillsQuery = `?start_time=${startTime}&page_size=100`;
    const fillsSig = this.generateSignature("GET", timestamp, fillsPath, fillsQuery, "", apiSecret);

    // 2. Fetch Orders (for Metadata like SL/TP/Leverage)
    const ordersPath = "/v2/orders";
    const ordersQuery = `?start_time=${startTime}&page_size=100`;
    const ordersSig = this.generateSignature("GET", timestamp, ordersPath, ordersQuery, "", apiSecret);

    try {
      const [fillsRes, ordersRes] = await Promise.all([
        axios.get(`${DELTA_BASE_URL}${fillsPath}${fillsQuery}`, {
          headers: { "api-key": apiKey, signature: fillsSig, timestamp, "User-Agent": "TradeDiary/1.0" },
        }),
        axios.get(`${DELTA_BASE_URL}${ordersPath}${ordersQuery}`, {
          headers: { "api-key": apiKey, signature: ordersSig, timestamp, "User-Agent": "TradeDiary/1.0" },
        })
      ]);

      if (!fillsRes.data?.success) throw new Error("Failed to fetch fills");
      
      const fills = fillsRes.data.result || [];
      const ordersMap = new Map();
      (ordersRes.data?.result || []).forEach((o: any) => ordersMap.set(o.id, o));

      // 3. FIFO Matching Logic
      const trades: any[] = [];
      const symbols = [...new Set(fills.map((f: any) => f.product_symbol))];

      symbols.forEach((symbol: any) => {
        const symbolFills = fills
          .filter((f: any) => f.product_symbol === symbol)
          .sort((a: any, b: any) => parseInt(a.created_at) - parseInt(b.created_at));

        const buyQueue: any[] = [];
        const sellQueue: any[] = [];

        symbolFills.forEach((fill: any) => {
          const side = fill.side.toLowerCase();
          const quantity = parseFloat(fill.size);
          const price = parseFloat(fill.price);
          const commission = parseFloat(fill.commission || 0);
          const time = parseInt(fill.created_at) / 1000; // to ms

          if (side === "buy") {
            this.matchFill(buyQueue, sellQueue, "LONG", fill, ordersMap, trades, clerkId);
          } else {
            this.matchFill(sellQueue, buyQueue, "SHORT", fill, ordersMap, trades, clerkId);
          }
        });
      });

      return trades;
    } catch (error: any) {
      console.error("❌ Delta Sync Refactor Error:", error.response?.data || error.message);
      throw error;
    }
  }

  private static matchFill(
    myQueue: any[],
    opposingQueue: any[],
    direction: "LONG" | "SHORT",
    fill: any,
    ordersMap: Map<string, any>,
    trades: any[],
    clerkId: string
  ) {
    let remainingQty = parseFloat(fill.size);
    const fillPrice = parseFloat(fill.price);
    const fillTime = parseInt(fill.created_at) / 1000;
    const orderData = ordersMap.get(fill.order_id) || {};

    while (remainingQty > 0 && opposingQueue.length > 0) {
      const entry = opposingQueue[0];
      const matchQty = Math.min(remainingQty, entry.remainingQty);

      // Create a paired trade record
      const entryDateObj = new Date(entry.time);
      const exitDateObj = new Date(fillTime);
      
      const isIntraday = entryDateObj.toDateString() === exitDateObj.toDateString();
      const pnl = (direction === "SHORT" 
        ? entry.price - fillPrice // Short: Entry > Exit is profit
        : fillPrice - entry.price  // Long: Exit > Entry is profit
      ) * matchQty;

      const totalAmount = entry.price * matchQty;

      trades.push({
        clerkId,
        symbol: fill.product_symbol,
        marketType: "Crypto",
        direction: entry.direction, // The direction of the ENTRY
        duration: isIntraday ? "INTRADAY" : "SWING",
        entryDate: entryDateObj.toISOString().split("T")[0],
        exitDate: exitDateObj.toISOString().split("T")[0],
        entryTime: entryDateObj.toISOString().split("T")[1].substring(0, 5),
        exitTime: exitDateObj.toISOString().split("T")[1].substring(0, 5),
        entryPrice: entry.price,
        exitPrice: fillPrice,
        quantity: matchQty,
        pnl: pnl,
        pnlPercent: (pnl / totalAmount) * 100,
        charges: entry.commissionPerUnit * matchQty + (parseFloat(fill.commission || 0) / parseFloat(fill.size)) * matchQty,
        leverage: orderData.leverage || 1, // Reconstructed from order metadata
        stopLoss: parseFloat(orderData.stop_price) || 0,
        target: 0, // Delta doesn't have an explicit 'target' field in order history usually
        externalOrderId: `paired-${fill.id}-${entry.order_id}-${matchQty}`,
        externalBroker: "delta",
        outcome: pnl > 0 ? "PROFITABLE" : pnl === 0 ? "BREAK_EVEN" : "LOSS"
      });

      remainingQty -= matchQty;
      entry.remainingQty -= matchQty;
      if (entry.remainingQty <= 0) opposingQueue.shift();
    }

    if (remainingQty > 0) {
      myQueue.push({
        price: fillPrice,
        remainingQty: remainingQty,
        time: fillTime,
        commissionPerUnit: parseFloat(fill.commission || 0) / parseFloat(fill.size),
        direction: direction,
        order_id: fill.order_id
      });
    }
  }
}
