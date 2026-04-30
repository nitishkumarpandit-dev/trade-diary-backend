import { Request, Response } from "express";
import { User } from "../models/User";
import { Trade } from "../models/Trade";
import { DeltaService } from "../services/delta.service";
import { encrypt, decrypt } from "../utils/encryption.utils";

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

import { getUserId, handleApiError } from "../utils/auth";

// ─────────────────────────────────────────────────────────────────────────────
// connectDelta
// POST /api/broker/connect
// Body: { apiKey: string, apiSecret: string }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies Delta Exchange credentials then stores them encrypted on the user doc.
 *
 * Bugs fixed vs original:
 *  - Was calling DeltaService.verifyCredentials but the old service method had
 *    a different signature path. Now uses the current service's verifyCredentials.
 *  - Added input trimming so whitespace-only strings are caught early.
 */
export const connectDelta = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getUserId(req);
    const apiKey = (req.body.apiKey ?? "").trim();
    const apiSecret = (req.body.apiSecret ?? "").trim();

    if (!apiKey || !apiSecret) {
      res.status(400).json({ error: "API Key and Secret are required." });
      return;
    }

    // 1. Verify live against Delta Exchange before storing anything
    const { isValid, error } = await DeltaService.verifyCredentials(apiKey, apiSecret);
    if (!isValid) {
      res.status(401).json({
        error:
          error ??
          "Verification failed. Check your API Key/Secret and ensure your server IP is whitelisted on Delta Exchange.",
      });
      return;
    }

    // 2. Encrypt secret — never store plaintext
    const apiSecretEncrypted = encrypt(apiSecret);

    // 3. Upsert broker connection on user document
    await User.findOneAndUpdate(
      { clerkId },
      {
        $set: {
          brokerConnection: {
            brokerId: "delta",
            apiKey,
            apiSecretEncrypted,
            isConnected: true,
            lastVerifiedAt: new Date(),
            // Reset lastSyncedAt so a fresh sync always runs after reconnect
            lastSyncedAt: null,
          },
        },
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: "Delta Exchange connected successfully.",
      brokerId: "delta",
    });
  } catch (err: any) {
    console.error("❌ connectDelta error:", err);
    handleApiError(err, res);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getBrokerStatus
// GET /api/broker/status
// ─────────────────────────────────────────────────────────────────────────────

export const getBrokerStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getUserId(req);
    const user = await User.findOne({ clerkId }).select("brokerConnection").lean();

    if (!user?.brokerConnection?.isConnected) {
      res.json({ isConnected: false });
      return;
    }

    const { brokerId, apiKey, lastVerifiedAt, lastSyncedAt } = user.brokerConnection;

    res.json({
      isConnected: true,
      brokerId,
      apiKey,          // safe to return — only secret is sensitive
      lastVerifiedAt,
      lastSyncedAt: lastSyncedAt ?? null,
    });
  } catch (err: any) {
    console.error("❌ getBrokerStatus error:", err);
    handleApiError(err, res);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// disconnectBroker
// POST /api/broker/disconnect
// ─────────────────────────────────────────────────────────────────────────────

export const disconnectBroker = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getUserId(req);

    await User.findOneAndUpdate(
      { clerkId },
      {
        $set: {
          "brokerConnection.isConnected": false,
          "brokerConnection.lastVerifiedAt": new Date(),
        },
      }
    );

    res.json({ success: true, message: "Broker disconnected successfully." });
  } catch (err: any) {
    console.error("❌ disconnectBroker error:", err);
    handleApiError(err, res);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// syncTrades
// POST /api/broker/sync
//
// Bugs fixed vs original controller (doc 5):
//
//  1. Was calling DeltaService.getFillsAndMapToTrades — old method name.
//     Now calls DeltaService.syncTrades (current service API).
//
//  2. Used Trade.insertMany — silently skips duplicate key errors but leaves
//     partially-inserted states on re-run and fails on any unique-key violation.
//     Now uses bulkWrite with updateOne + upsert:true, keyed on externalOrderId.
//     Idempotent: safe to call multiple times; already-synced trades are updated
//     (not duplicated) so field fixes in the service flow through automatically.
//
//  3. Pre-fetched existingTrades with a separate find + Set to filter — requires
//     an extra round trip to MongoDB. Upsert handles dedup at the DB level.
//
//  4. Did not update lastSyncedAt after a successful sync.
//
//  5. Error path re-threw the error without logging context; now logs the
//     full error for server-side debugging.
// ─────────────────────────────────────────────────────────────────────────────

export const syncTrades = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getUserId(req);

    // ── 1. Load user & validate connection ──────────────────────────────────
    const user = await User.findOne({ clerkId }).select("brokerConnection").lean();

    if (!user?.brokerConnection?.isConnected) {
      res.status(400).json({ error: "No broker connected. Please connect Delta Exchange first." });
      return;
    }

    if (user.brokerConnection.brokerId !== "delta") {
      res.status(400).json({
        error: `Sync is not supported for broker "${user.brokerConnection.brokerId}". Only Delta Exchange is supported.`,
      });
      return;
    }

    // ── 2. Decrypt API secret ────────────────────────────────────────────────
    const apiSecret = decrypt(user.brokerConnection.apiSecretEncrypted);
    const { apiKey } = user.brokerConnection;

    // ── 3. Fetch & map trades from Delta Exchange ────────────────────────────
    //
    // DeltaService.syncTrades:
    //   - Fetches /v2/fills (paginated, last 7 days)
    //   - Fetches /v2/orders/history + /v2/orders (active) in parallel
    //   - FIFO-matches fills into complete entry/exit trade records
    //   - Returns typed ParsedTrade[]
    const parsedTrades = await DeltaService.syncTrades(apiKey, apiSecret, clerkId);

    if (parsedTrades.length === 0) {
      res.json({
        success: true,
        synced: 0,
        message: "No completed trades found on Delta Exchange for the last 7 days.",
      });
      return;
    }

    // ── 4. Upsert all trades — idempotent, no duplicates ────────────────────
    //
    // bulkWrite with upsert:true:
    //   - Inserts new trades (externalOrderId not yet in DB)
    //   - Updates existing trades (externalOrderId already in DB) with latest data
    //   - Single round-trip regardless of how many trades
    //
    // Requires a unique index on { externalOrderId, externalBroker }
    // in your Trade schema:
    //   tradeSchema.index({ externalOrderId: 1, externalBroker: 1 }, { unique: true });
    //
    const bulkOps = parsedTrades.map((trade) => ({
      updateOne: {
        filter: {
          clerkId: trade.clerkId,
          externalOrderId: trade.externalOrderId,
          externalBroker: trade.externalBroker,
        },
        update: { $set: trade },
        upsert: true,
      },
    }));

    const bulkResult = await Trade.bulkWrite(bulkOps, { ordered: false });

    // Count how many were genuinely new inserts vs updates
    const inserted = bulkResult.upsertedCount;
    const updated = bulkResult.modifiedCount;

    // ── 5. Stamp lastSyncedAt on the user document ───────────────────────────
    await User.updateOne(
      { clerkId },
      { $set: { "brokerConnection.lastSyncedAt": new Date() } }
    );

    // ── 6. Respond ───────────────────────────────────────────────────────────
    const message =
      inserted > 0
        ? `Synced ${inserted} new trade${inserted !== 1 ? "s" : ""}${updated > 0 ? ` and updated ${updated}` : ""} from Delta Exchange.`
        : updated > 0
          ? `No new trades. Updated ${updated} existing trade${updated !== 1 ? "s" : ""}.`
          : "Your journal is already up-to-date. No new trades were found.";

    res.json({
      success: true,
      synced: inserted,
      updated,
      total: parsedTrades.length,
      message,
    });
  } catch (err: any) {
    console.error("❌ syncTrades error:", err.response?.data ?? err.message ?? err);
    handleApiError(err, res);
  }
};