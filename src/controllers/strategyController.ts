import { Request, Response } from "express";
import { Strategy } from "../models/Strategy";

// Helper to safely get clerk user ID
const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

// GET /api/strategies
export const getStrategies = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    
    // Aggregation pipeline to join with trades and compute real-time performance stats
    const strategies = await Strategy.aggregate([
      { $match: { clerkId } },
      {
        $lookup: {
          from: "trades", // Note: collection name is 'trades'
          localField: "_id",
          foreignField: "strategy",
          as: "tradesList",
        },
      },
      {
        $addFields: {
          computedTradesExecuted: { $size: "$tradesList" },
          computedNetPnl: { $sum: "$tradesList.pnl" },
          wins: {
            $size: {
              $filter: {
                input: "$tradesList",
                as: "trade",
                cond: { $eq: ["$$trade.outcome", "PROFITABLE"] },
              },
            },
          },
          grossProfit: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$tradesList",
                    as: "trade",
                    cond: { $gt: ["$$trade.pnl", 0] },
                  },
                },
                as: "t",
                in: "$$t.pnl",
              },
            },
          },
          grossLoss: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$tradesList",
                    as: "trade",
                    cond: { $lt: ["$$trade.pnl", 0] },
                  },
                },
                as: "t",
                in: { $abs: "$$t.pnl" },
              },
            },
          },
        },
      },
      {
        $addFields: {
          computedWinRate: {
            $cond: [
              { $gt: ["$computedTradesExecuted", 0] },
              { $multiply: [{ $divide: ["$wins", "$computedTradesExecuted"] }, 100] },
              0,
            ],
          },
          computedProfitFactor: {
            $cond: [
              { $eq: ["$grossLoss", 0] },
              { $cond: [{ $gt: ["$grossProfit", 0] }, 100, 0] },
              { $divide: ["$grossProfit", "$grossLoss"] },
            ],
          },
        },
      },
      {
        $project: {
          tradesList: 0,
          wins: 0,
          grossProfit: 0,
          grossLoss: 0,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    // Map _id to id and assign computed stats to the main fields
    const formatted = strategies.map((s) => ({
      ...s,
      id: s._id.toString(),
      netPnl: s.computedNetPnl ?? s.netPnl,
      tradesExecuted: s.computedTradesExecuted ?? s.tradesExecuted,
      winRate: s.computedWinRate ?? s.winRate,
      profitFactor: s.computedProfitFactor ?? s.profitFactor,
    }));

    res.json(formatted);

    // Save the computed aggregated fields back to the DB asynchronously
    if (formatted.length > 0) {
      const bulkOps = formatted.map((s) => ({
        updateOne: {
          filter: { _id: s._id },
          update: {
            $set: {
              netPnl: s.netPnl,
              tradesExecuted: s.tradesExecuted,
              winRate: s.winRate,
              profitFactor: s.profitFactor,
            },
          },
        },
      }));
      Strategy.bulkWrite(bulkOps).catch((err) => console.error("Bulk write error:", err));
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/strategies/:id
export const getStrategy = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const strategy = await Strategy.findOne({ _id: req.params.id, clerkId });
    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }
    res.json(strategy);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// POST /api/strategies
export const createStrategy = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const strategy = new Strategy({ ...req.body, clerkId });
    await strategy.save();
    res.status(201).json(strategy);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// PATCH /api/strategies/:id
export const updateStrategy = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const strategy = await Strategy.findOneAndUpdate(
      { _id: req.params.id, clerkId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }
    res.json(strategy);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// DELETE /api/strategies/:id
export const deleteStrategy = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const strategy = await Strategy.findOneAndDelete({ _id: req.params.id, clerkId });
    if (!strategy) {
      return res.status(404).json({ error: "Strategy not found" });
    }
    res.json({ message: "Strategy deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
