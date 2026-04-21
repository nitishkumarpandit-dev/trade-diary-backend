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
    // Delta expects start_time in microseconds (16 digits)
    const startTimeMicro = (Date.now() - 7 * 24 * 60 * 60 * 1000) * 1000;

    const fillsPath = "/v2/fills";
    const fillsQuery = `?start_time=${startTimeMicro}&page_size=100`;
    const fillsSig = this.generateSignature("GET", timestamp, fillsPath, fillsQuery, "", apiSecret);

    const ordersPath = "/v2/orders";
    const ordersQuery = `?start_time=${startTimeMicro}&page_size=100`;
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

      const trades: any[] = [];
      const symbols = [...new Set(fills.map((f: any) => f.product_symbol))];

      symbols.forEach((symbol: any) => {
        const symbolFills = fills
          .filter((f: any) => f.product_symbol === symbol)
          .sort((a: any, b: any) => this.parseDeltaTimestamp(a.created_at).getTime() - this.parseDeltaTimestamp(b.created_at).getTime());

        const buyQueue: any[] = [];
        const sellQueue: any[] = [];

        symbolFills.forEach((fill: any) => {
          const side = fill.side.toLowerCase();
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

  /**
   * Robust parser that handles Seconds (10 digits) or Microseconds (16 digits)
   * and converts the result to the IST (Asia/Kolkata) timezone.
   */
  private static parseDeltaTimestamp(timestampStr: string): Date {
    const ts = parseInt(timestampStr);
    if (isNaN(ts)) return new Date(0);

    let ms = 0;
    // Auto-detect unit: Microseconds are typically 16 digits, Seconds are 10.
    if (ts > 10000000000000) { 
      ms = ts / 1000; 
    } else if (ts > 1000000000) { 
      ms = ts * 1000; 
    } else {
      ms = ts * 1000; // Default to seconds if unsure
    }

    const date = new Date(ms);
    // Adjust to IST (+5:30)
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    return new Date(date.getTime() + IST_OFFSET);
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
    
    // Parse current fill time to IST
    const exitDateIST = this.parseDeltaTimestamp(fill.created_at);
    const orderData = ordersMap.get(fill.order_id) || {};

    while (remainingQty > 0 && opposingQueue.length > 0) {
      const entry = opposingQueue[0];
      const matchQty = Math.min(remainingQty, entry.remainingQty);

      // Entry time is already in IST if we used parseDeltaTimestamp when pushing to myQueue
      const entryDateIST = entry.istDate;
      
      const isIntraday = entryDateIST.toDateString() === exitDateIST.toDateString();
      const pnl = (direction === "SHORT" 
        ? entry.price - fillPrice 
        : fillPrice - entry.price  
      ) * matchQty;

      const totalAmount = entry.price * matchQty;

      trades.push({
        clerkId,
        symbol: fill.product_symbol,
        marketType: "Crypto",
        direction: entry.direction, 
        duration: isIntraday ? "INTRADAY" : "SWING",
        entryDate: entryDateIST.toISOString().split("T")[0],
        exitDate: exitDateIST.toISOString().split("T")[0],
        entryTime: entryDateIST.toISOString().split("T")[1].substring(0, 5),
        exitTime: exitDateIST.toISOString().split("T")[1].substring(0, 5),
        entryPrice: entry.price,
        exitPrice: fillPrice,
        quantity: matchQty,
        pnl: pnl,
        pnlPercent: totalAmount > 0 ? (pnl / totalAmount) * 100 : 0,
        charges: entry.commissionPerUnit * matchQty + (parseFloat(fill.commission || 0) / parseFloat(fill.size)) * matchQty,
        leverage: orderData.leverage || 1, 
        stopLoss: parseFloat(orderData.stop_price) || 0,
        target: 0, 
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
        istDate: exitDateIST, // Store the IST Date object for matching later
        commissionPerUnit: parseFloat(fill.commission || 0) / parseFloat(fill.size),
        direction: direction,
        order_id: fill.order_id
      });
    }
  }
}
