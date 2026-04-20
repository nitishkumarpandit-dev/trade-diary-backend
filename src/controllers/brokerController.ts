import { Request, Response } from "express";
import { User } from "../models/User";
import { Trade } from "../models/Trade";
import { DeltaService } from "../services/delta.service";
import { encrypt, decrypt } from "../utils/encryption.utils";

/**
 * Extracts Clerk User ID from request auth.
 */
const getClerkId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

/**
 * Connects a Delta Exchange account by verifying credentials and saving them securely.
 */
export const connectDelta = async (req: Request, res: Response) => {
  try {
    const clerkId = getClerkId(req);
    const { apiKey, apiSecret } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: "API Key and Secret are required" });
    }

    // 1. Verify credentials with Delta Exchange
    const { isValid, error } = await DeltaService.verifyCredentials(apiKey, apiSecret);
    if (!isValid) {
      return res.status(401).json({ 
        error: error || "Verification failed. Please check your API Key/Secret and ensure your IP is whitelisted on Delta Exchange." 
      });
    }

    // 2. Encrypt secret before storing
    const apiSecretEncrypted = encrypt(apiSecret);

    // 3. Update user profile with connection details
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
          },
        },
      },
      { upsert: true }
    );

    res.json({ 
      success: true, 
      message: "Delta Exchange connected successfully", 
      brokerId: "delta" 
    });
  } catch (error: any) {
    console.error("Connect Broker Error:", error);
    res.status(500).json({ error: error.message || "Failed to connect broker" });
  }
};

/**
 * Retrieves the current broker connection status for the user.
 */
export const getBrokerStatus = async (req: Request, res: Response) => {
  try {
    const clerkId = getClerkId(req);
    const user = await User.findOne({ clerkId });

    if (!user || !user.brokerConnection || !user.brokerConnection.isConnected) {
      return res.json({ isConnected: false });
    }

    res.json({
      isConnected: true,
      brokerId: user.brokerConnection.brokerId,
      apiKey: user.brokerConnection.apiKey,
      lastVerifiedAt: user.brokerConnection.lastVerifiedAt,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Disconnects the current broker.
 */
export const disconnectBroker = async (req: Request, res: Response) => {
  try {
    const clerkId = getClerkId(req);
    
    await User.findOneAndUpdate(
      { clerkId },
      {
        $set: {
          "brokerConnection.isConnected": false,
          "brokerConnection.lastVerifiedAt": new Date(),
        },
      }
    );

    res.json({ success: true, message: "Broker disconnected successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Synchronizes trades from the connected broker for the last 30 days.
 */
export const syncTrades = async (req: Request, res: Response) => {
  try {
    const clerkId = getClerkId(req);
    const user = await User.findOne({ clerkId });

    if (!user || !user.brokerConnection || !user.brokerConnection.isConnected) {
      return res.status(400).json({ error: "No broker connected" });
    }

    if (user.brokerConnection.brokerId !== "delta") {
      return res.status(400).json({ error: "Synchronizing trades is currently only supported for Delta Exchange" });
    }

    // 1. Decrypt the API Secret
    const apiSecret = decrypt(user.brokerConnection.apiSecretEncrypted);
    const { apiKey } = user.brokerConnection;

    // 2. Fetch and map trades from Delta
    const syncedTradesData = await DeltaService.getFillsAndMapToTrades(apiKey, apiSecret, clerkId);

    if (syncedTradesData.length === 0) {
      return res.json({ success: true, message: "No new trades found in the last 30 days", count: 0 });
    }

    // 3. Filter out trades that already exist in our DB (Skip duplicates)
    const externalOrderIds = syncedTradesData.map((t: any) => t.externalOrderId);
    const existingTrades = await Trade.find({
      clerkId,
      externalOrderId: { $in: externalOrderIds },
      externalBroker: "delta"
    }).select("externalOrderId");

    const existingIds = new Set(existingTrades.map(t => t.externalOrderId));
    const newTradesToInsert = syncedTradesData.filter((t: any) => !existingIds.has(t.externalOrderId));

    if (newTradesToInsert.length > 0) {
      // 4. Save new trades
      await Trade.insertMany(newTradesToInsert);
    }

    res.json({
      success: true,
      message: `Synchronized ${newTradesToInsert.length} new trades (grouped by Order ID)`,
      count: newTradesToInsert.length
    });
  } catch (error: any) {
    console.error("Sync Trades Error:", error);
    res.status(500).json({ error: error.message || "Failed to synchronize trades" });
  }
};
