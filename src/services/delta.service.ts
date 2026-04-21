import axios, { AxiosInstance } from "axios";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DELTA_BASE_URL = "https://api.india.delta.exchange";
const USER_AGENT = "TradeDiary/3.0";
const SYNC_DAYS = 7;
const PAGE_SIZE = 100; // max Delta allows

// IST offset in ms (UTC+5:30)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Raw API types  (exactly what Delta returns)
// ─────────────────────────────────────────────────────────────────────────────

interface DeltaFill {
  id: number;
  order_id: number;
  product_id: number;
  product_symbol: string;
  side: "buy" | "sell";
  size: string;       // contracts, number-as-string
  fill_price: string;       // number-as-string
  commission: string;       // always positive, number-as-string
  created_at: string;       // microsecond-epoch string e.g. "1713700123456789"
  meta_data?: {
    closed_pnl?: string; // realized PnL for this fill
    order_margin_blocked?: string; // margin locked at order placement
    order_size?: number;
    order_price?: string;
  };
  product?: {
    contract_type?: string;  // "perpetual_futures"|"futures"|"call_options"|"put_options"
    contract_value?: string;  // per-contract notional
    default_leverage?: string;
  };
}

interface DeltaOrder {
  id: number;
  product_id: number;
  product_symbol: string;
  side: "buy" | "sell";
  stop_price?: string;   // SL trigger price
  stop_order_type?: string;   // "stop_loss_order" when present
  bracket_take_profit_price?: string;   // TP trigger price
  bracket_stop_loss_price?: string;   // bracket SL (alternative field)
  leverage?: number | string;
  state: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One open leg waiting to be matched with its exit.
 * Represents a single fill that opened (or partially opened) a position.
 */
interface OpenLeg {
  fillId: number;
  orderId: number;
  price: number;
  originalQty: number;   // fill size at creation — never mutated
  remainingQty: number;   // contracts still unmatched (decremented on match)
  timeMs: number;   // entry timestamp in ms (pre-computed once)
  commissionPerUnit: number;   // commission / size for this fill
  direction: "LONG" | "SHORT";
  contractType: string;
  leverage: number;
  stopLoss: number | null;
  target: number | null;
  margin: number;   // margin_blocked at this fill's order
}

/** Final trade written to MongoDB */
export interface ParsedTrade {
  clerkId: string;

  // Identity
  symbol: string;
  marketType: string;
  direction: "LONG" | "SHORT";

  // Duration
  duration: "INTRADAY" | "SWING";

  // Dates & Times (IST)
  entryDate: string;   // "YYYY-MM-DD"
  exitDate: string;   // "YYYY-MM-DD"
  entryTime: string;   // "HH:MM:SS"
  exitTime: string;   // "HH:MM:SS"

  // Prices
  entryPrice: number;
  exitPrice: number;
  quantity: number;  // contracts matched

  // Financials
  totalAmount: number;   // entryPrice × quantity (notional at entry)
  pnl: number;   // realized P&L
  pnlPercent: number;   // (pnl / totalAmount) × 100
  charges: number;   // total commission (entry + exit side)
  margin: number;   // margin blocked at entry
  leverage: number;

  // Risk
  stopLoss: number | null;
  target: number | null;

  // Meta
  outcome: "PROFITABLE" | "LOSS" | "BREAK_EVEN";
  externalOrderId: string;
  externalBroker: "delta";
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts any Delta timestamp to milliseconds — called once per fill,
 * result cached so sort never re-parses.
 *
 * /v2/fills   created_at → microsecond epoch INTEGER string, 16 digits
 *                          e.g. "1713700123456789"
 * /v2/orders  created_at → ISO 8601 UTC string
 *                          e.g. "2024-04-21T10:30:00Z"
 *
 * Detection rules (in order):
 *  1. Contains "T"           → ISO 8601 datetime  (orders endpoint)
 *  2. Starts with 4 digits + "-" → ISO 8601 date-only (never seen but safe)
 *  3. Pure numeric, >1e15    → microseconds → divide by 1000  (fills endpoint)
 *  4. Pure numeric, <1e12    → seconds      → multiply by 1000
 *  5. Pure numeric, else     → milliseconds (pass through)
 */
function toMs(ts: unknown): number {
  if (!ts) return Date.now();
  const s = String(ts).trim();

  // ISO 8601: must contain "T" (datetime) or match YYYY- pattern (date-only)
  if (s.includes("T") || /^\d{4}-/.test(s)) {
    const p = Date.parse(s);
    return isNaN(p) ? Date.now() : p;
  }

  const n = Number(s);
  if (isNaN(n)) return Date.now();
  if (n > 1e15) return Math.round(n / 1000); // microseconds → ms
  if (n < 1e12) return n * 1000;             // seconds → ms
  return n;                                  // already ms
}

/**
 * Fast IST date string "YYYY-MM-DD" without Intl overhead.
 * Adds IST offset then reads UTC getters (no locale engine).
 */
function istDateStr(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * Fast IST time string "HH:MM:SS" without Intl overhead.
 */
function istTimeStr(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${mi}:${s}`;
}

function toMarketType(contractType = ""): string {
  const MAP: Record<string, string> = {
    perpetual_futures: "Perpetual Futures",
    futures: "Futures",
    call_options: "Call Option",
    put_options: "Put Option",
    move_options: "Move Option",
    interest_rate_swaps: "Interest Rate Swap",
  };
  return MAP[contractType] ?? (contractType || "Perpetual Futures");
}

function safeFloat(v: string | number | undefined | null, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = parseFloat(String(v));
  return isNaN(n) ? fallback : n;
}

/** Round to 8 decimal places — avoids floating-point noise in stored values */
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP client — singleton Axios instance with keep-alive + timeout
// ─────────────────────────────────────────────────────────────────────────────

const http: AxiosInstance = axios.create({
  baseURL: DELTA_BASE_URL,
  timeout: 15_000,
  headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json" },
});

function sign(
  method: string,
  ts: string,
  path: string,
  query: string,
  body: string,
  secret: string
): string {
  const pre = method.toUpperCase() + ts + path + query + body;
  return crypto.createHmac("sha256", secret).update(pre).digest("hex");
}

/** Builds signed auth headers. `query` must include the leading "?". */
function authHeaders(
  apiKey: string,
  secret: string,
  method: string,
  path: string,
  query = "",
  body = ""
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    "api-key": apiKey,
    signature: sign(method, ts, path, query, body, secret),
    timestamp: ts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic paginator — works for any Delta endpoint with meta.after cursor
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAllPages<T>(
  apiKey: string,
  secret: string,
  path: string,
  baseParams: Record<string, string>
): Promise<T[]> {
  const results: T[] = [];
  let after: string | null = null;

  do {
    const params: Record<string, string> = {
      ...baseParams,
      page_size: String(PAGE_SIZE),
    };
    if (after) params.after = after;

    // Query string built once — reused in both URL and signature
    const query = "?" + new URLSearchParams(params).toString();
    const headers = authHeaders(apiKey, secret, "GET", path, query);

    const res = await http.get<{
      success: boolean;
      result: T[];
      meta?: { after?: string | null };
    }>(path + query, { headers });

    if (!res.data?.success) {
      throw new Error(`Delta API ${path} error: ${JSON.stringify(res.data)}`);
    }

    const page = res.data.result ?? [];
    results.push(...page);
    after = res.data.meta?.after ?? null;

    if (page.length < PAGE_SIZE) break; // last page
  } while (after);

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// DeltaService
// ─────────────────────────────────────────────────────────────────────────────

export class DeltaService {

  // ── Credential Verification ─────────────────────────────────────────────────

  static async verifyCredentials(
    apiKey: string,
    apiSecret: string
  ): Promise<{ isValid: boolean; error?: string }> {
    const path = "/v2/wallet/balances";
    try {
      const res = await http.get(path, {
        headers: authHeaders(apiKey, apiSecret, "GET", path),
      });
      return { isValid: res.status === 200 };
    } catch (err) {
      return { isValid: false, error: extractErrorMessage(err) };
    }
  }

  // ── Main Sync ───────────────────────────────────────────────────────────────

  /**
   * Fetches fills + active orders + order history in parallel, then
   * FIFO-matches entry/exit fills into complete ParsedTrade objects.
   */
  static async syncTrades(
    apiKey: string,
    apiSecret: string,
    clerkId: string
  ): Promise<ParsedTrade[]> {
    const startMicro = String((Date.now() - SYNC_DAYS * 86_400_000) * 1000);
    const timeParams = { start_time: startMicro };

    // All three network calls start simultaneously.
    // Total wait = slowest single call, not the sum of all three.
    //
    // closedOrders  → SL prices for fills whose orders have already closed/cancelled
    // activeOrders  → bracket SL/TP for positions still open (orders still pending)
    const [fills, closedOrders, activeOrders] = await Promise.all([
      fetchAllPages<DeltaFill>(apiKey, apiSecret, "/v2/fills", timeParams),
      fetchAllPages<DeltaOrder>(apiKey, apiSecret, "/v2/orders/history", timeParams)
        .catch((): DeltaOrder[] => []),
      fetchAllPages<DeltaOrder>(apiKey, apiSecret, "/v2/orders", { states: "open,pending" })
        .catch((): DeltaOrder[] => []),
    ]);

    // Merge: closed orders take precedence over active (come later in the array)
    const ordersMap = new Map<number, DeltaOrder>();
    for (const o of [...activeOrders, ...closedOrders]) ordersMap.set(o.id, o);

    return matchFillsToTrades(fills, ordersMap, clerkId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIFO trade matching
// ─────────────────────────────────────────────────────────────────────────────

function matchFillsToTrades(
  fills: DeltaFill[],
  ordersMap: Map<number, DeltaOrder>,
  clerkId: string
): ParsedTrade[] {
  const trades: ParsedTrade[] = [];

  // ── 1. Pre-compute timestamps once ────────────────────────────────────────
  // Avoids re-parsing the microsecond string in every sort comparison.
  const tsCache = new Map<number, number>(); // fill.id → ms
  for (const f of fills) tsCache.set(f.id, toMs(f.created_at));

  // ── 2. Group by product_id (numeric, not symbol string) ───────────────────
  const byProduct = new Map<number, DeltaFill[]>();
  for (const f of fills) {
    const bucket = byProduct.get(f.product_id);
    if (bucket) bucket.push(f);
    else byProduct.set(f.product_id, [f]);
  }

  // ── 3. Process each product independently ─────────────────────────────────
  for (const [, productFills] of byProduct) {

    // Sort oldest → newest using cached ms timestamps (no re-parsing)
    productFills.sort((a, b) => tsCache.get(a.id)! - tsCache.get(b.id)!);

    // ── Two FIFO queues — one per direction ─────────────────────────────────
    // Use index pointers instead of Array.shift() → O(1) dequeue vs O(n).
    const longLegs: OpenLeg[] = [];
    const shortLegs: OpenLeg[] = [];
    let longHead = 0;
    let shortHead = 0;

    for (const fill of productFills) {
      const order = ordersMap.get(fill.order_id);
      const timeMs = tsCache.get(fill.id)!;
      const leg = buildOpenLeg(fill, order, timeMs);

      if (fill.side === "buy") {
        // BUY → closes a SHORT first, then any remainder opens a LONG
        shortHead = consumeLegs(shortLegs, shortHead, leg, "SHORT", fill, trades, clerkId);
        if (leg.remainingQty > 1e-9) {
          leg.direction = "LONG";
          longLegs.push(leg);
        }
      } else {
        // SELL → closes a LONG first, then any remainder opens a SHORT
        longHead = consumeLegs(longLegs, longHead, leg, "LONG", fill, trades, clerkId);
        if (leg.remainingQty > 1e-9) {
          leg.direction = "SHORT";
          shortLegs.push(leg);
        }
      }
    }
  }

  return trades;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build an OpenLeg from a raw fill + optional order
// ─────────────────────────────────────────────────────────────────────────────

function buildOpenLeg(
  fill: DeltaFill,
  order: DeltaOrder | undefined,
  timeMs: number
): OpenLeg {
  const qty = safeFloat(fill.size);
  const commission = safeFloat(fill.commission);

  const commissionPerUnit = qty > 0 ? commission / qty : 0;

  // Leverage: matched order → product default → 1×
  const leverage =
    safeFloat(String(order?.leverage ?? ""), 0) ||
    safeFloat(fill.product?.default_leverage, 0) ||
    1;

  // SL: stop_loss_order's stop_price is most precise;
  //     fall back to bracket_stop_loss_price for bracket orders
  const rawSL =
    order?.stop_order_type === "stop_loss_order"
      ? safeFloat(order.stop_price, 0)
      : safeFloat(order?.bracket_stop_loss_price, 0);
  const stopLoss = rawSL > 0 ? rawSL : null;

  // TP: bracket_take_profit_price
  const rawTP = safeFloat(order?.bracket_take_profit_price, 0);
  const target = rawTP > 0 ? rawTP : null;

  // Margin: set at order creation time — most accurate source
  const margin = safeFloat(fill.meta_data?.order_margin_blocked, 0);

  return {
    fillId: fill.id,
    orderId: fill.order_id,
    price: safeFloat(fill.fill_price),
    originalQty: qty,   // immutable for proportional margin scaling
    remainingQty: qty,
    timeMs,
    commissionPerUnit,
    direction: "LONG",   // overridden by caller
    contractType: fill.product?.contract_type ?? "perpetual_futures",
    leverage,
    stopLoss,
    target,
    margin,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core match loop — O(1) dequeue via head pointer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drains `exitLeg.remainingQty` against entries starting at `headIdx`.
 * Returns the updated head index after consuming fully-matched entries.
 *
 * @param queue     - entry-side queue (longLegs or shortLegs)
 * @param headIdx   - current front-of-queue pointer
 * @param exitLeg   - closing fill (mutated: remainingQty decremented)
 * @param entryDir  - direction of entries in queue
 * @param exitFill  - raw fill object (for closed_pnl + fill id)
 * @param trades    - output array
 * @param clerkId   - Clerk user id
 */
function consumeLegs(
  queue: OpenLeg[],
  headIdx: number,
  exitLeg: OpenLeg,
  entryDir: "LONG" | "SHORT",
  exitFill: DeltaFill,
  trades: ParsedTrade[],
  clerkId: string
): number {
  while (exitLeg.remainingQty > 1e-9 && headIdx < queue.length) {
    const entry = queue[headIdx];
    const matchedQty = Math.min(exitLeg.remainingQty, entry.remainingQty);

    // ── Dates & times (fast IST, no Intl) ─────────────────────────────────
    const entryDateStr = istDateStr(entry.timeMs);
    const exitDateStr = istDateStr(exitLeg.timeMs);
    const duration: "INTRADAY" | "SWING" =
      entryDateStr === exitDateStr ? "INTRADAY" : "SWING";

    // ── Prices ────────────────────────────────────────────────────────────
    const entryPrice = entry.price;
    const exitPrice = exitLeg.price;
    const totalAmount = entryPrice * matchedQty;

    // ── P&L ───────────────────────────────────────────────────────────────
    // closed_pnl in fill metadata is the server-calculated realized P&L.
    // It covers the full exit fill size, so scale proportionally when this
    // match covers only part of that fill (partial close scenario).
    const rawPnl =
      entryDir === "LONG"
        ? (exitPrice - entryPrice) * matchedQty
        : (entryPrice - exitPrice) * matchedQty;

    const exitFillSize = safeFloat(exitFill.size, 1);
    const closedPnlFull = safeFloat(exitFill.meta_data?.closed_pnl ?? "", NaN);
    const pnl = !isNaN(closedPnlFull)
      ? closedPnlFull * (matchedQty / exitFillSize)  // proportional scaling
      : rawPnl;

    // ── Charges ───────────────────────────────────────────────────────────
    const charges =
      entry.commissionPerUnit * matchedQty +
      exitLeg.commissionPerUnit * matchedQty;

    const pnlPercent = totalAmount > 0 ? (pnl / totalAmount) * 100 : 0;

    // ── Leverage & margin ─────────────────────────────────────────────────
    const leverage = entry.leverage > 1 ? entry.leverage : exitLeg.leverage;
    // Scale margin proportionally to the matched portion of the ORIGINAL fill size.
    // entry.originalQty is the immutable fill size; entry.remainingQty shrinks on
    // each partial match so using it here would over-scale on subsequent matches.
    const matchFraction = entry.originalQty > 0 ? matchedQty / entry.originalQty : 1;
    const margin =
      entry.margin > 0
        ? entry.margin * matchFraction
        : leverage > 1
          ? (entryPrice * matchedQty) / leverage
          : entryPrice * matchedQty;

    // ── SL / TP ───────────────────────────────────────────────────────────
    const stopLoss = entry.stopLoss ?? exitLeg.stopLoss ?? null;
    const target = entry.target ?? exitLeg.target ?? null;

    // ── Outcome ───────────────────────────────────────────────────────────
    // Use a small epsilon to treat floating-point near-zero as BREAK_EVEN
    const outcome =
      pnl > 0.0001 ? "PROFITABLE" : pnl < -0.0001 ? "LOSS" : "BREAK_EVEN";

    trades.push({
      clerkId,
      symbol: exitFill.product_symbol,
      marketType: toMarketType(entry.contractType),
      direction: entryDir,
      duration,
      entryDate: entryDateStr,
      exitDate: exitDateStr,
      entryTime: istTimeStr(entry.timeMs),
      exitTime: istTimeStr(exitLeg.timeMs),
      entryPrice,
      exitPrice,
      quantity: matchedQty,
      totalAmount: round8(totalAmount),
      pnl: round8(pnl),
      pnlPercent: round8(pnlPercent),
      charges: round8(charges),
      margin: round8(margin),
      leverage,
      stopLoss,
      target,
      outcome,
      // entry fillId + exit fillId + matched qty = globally unique dedup key
      externalOrderId: `delta-${entry.fillId}-${exitFill.id}-${matchedQty}`,
      externalBroker: "delta",
    });

    // ── Consume matched quantities ─────────────────────────────────────────
    exitLeg.remainingQty -= matchedQty;
    entry.remainingQty -= matchedQty;

    // Advance pointer when entry fully consumed (O(1), no array splice)
    if (entry.remainingQty <= 1e-9) headIdx++;
  }

  return headIdx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error message extractor
// ─────────────────────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "Unknown error.";
  const e = err as any;
  if (!e.response) return "Network error while connecting to Delta Exchange.";

  const { status, data } = e.response;
  const code = typeof data?.error === "string"
    ? data.error
    : (data?.error?.code ?? "");
  const msg = typeof data?.message === "string" ? data.message : "";

  if (status === 401 || status === 403) {
    if (/whitelist|ip/i.test(code + msg))
      return "IP not whitelisted. Add your server IP in Delta API settings.";
    if (/invalid_api_key|signature/i.test(code + msg))
      return "Invalid API Key or Secret. Check your credentials.";
  }

  return msg || code || `Delta API error (HTTP ${status}).`;
}