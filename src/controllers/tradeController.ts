import { Request, Response } from "express";
import mongoose from "mongoose";
import { Trade } from "../models/Trade";
import { Strategy } from "../models/Strategy";

const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

const syncStrategyStats = async (clerkId: string, strategyId: any) => {
  if (!strategyId) return;
  try {
    const stats = await Trade.aggregate([
      { $match: { clerkId, strategy: new mongoose.Types.ObjectId(strategyId.toString()) } },
      {
        $group: {
          _id: "$strategy",
          tradesExecuted: { $sum: 1 },
          netPnl: { $sum: "$pnl" },
          wins: {
            $sum: { $cond: [{ $eq: ["$outcome", "PROFITABLE"] }, 1, 0] }
          },
          grossProfit: {
            $sum: { $cond: [{ $gt: ["$pnl", 0] }, "$pnl", 0] }
          },
          grossLoss: {
            $sum: { $cond: [{ $lt: ["$pnl", 0] }, { $abs: "$pnl" }, 0] }
          }
        }
      },
      {
        $project: {
          tradesExecuted: 1,
          netPnl: 1,
          winRate: {
            $cond: [
              { $gt: ["$tradesExecuted", 0] },
              { $multiply: [{ $divide: ["$wins", "$tradesExecuted"] }, 100] },
              0
            ]
          },
          profitFactor: {
            $cond: [
              { $eq: ["$grossLoss", 0] },
              { $cond: [{ $gt: ["$grossProfit", 0] }, 100, 0] },
              { $divide: ["$grossProfit", "$grossLoss"] }
            ]
          }
        }
      }
    ]);

    let updateData = { tradesExecuted: 0, netPnl: 0, winRate: 0, profitFactor: 0 };
    if (stats.length > 0) {
      updateData = stats[0];
    }

    await Strategy.findOneAndUpdate(
      { _id: strategyId, clerkId },
      { $set: updateData }
    );
  } catch (err) {
    console.error("Failed to sync strategy stats:", err);
  }
};

// GET /api/trades
export const getTrades = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    
    // Simple filtering options from query params
    const filter: any = { clerkId };
    if (req.query.marketType) {
      filter.marketType = req.query.marketType;
    }
    
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const skip = (page - 1) * limit;

    const trades = await Trade.find(filter)
      .populate("strategy", "name")
      .populate("rules", "name category")
      .populate("mistakes", "name severity impact")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await Trade.countDocuments(filter);

    res.json({
      trades,
      pagination: {
        total: totalCount,
        page,
        pages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/trades/:id
export const getTrade = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const trade = await Trade.findOne({ _id: req.params.id, clerkId })
      .populate("strategy")
      .populate("rules")
      .populate("mistakes");

    if (!trade) {
      return res.status(404).json({ error: "Trade not found" });
    }
    res.json(trade);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// POST /api/trades
export const createTrade = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    
    const trade = new Trade({ ...req.body, clerkId });
    await trade.save();
    
    if (trade.strategy) {
       await syncStrategyStats(clerkId, trade.strategy);
    }
    
    res.status(201).json(trade);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// PATCH /api/trades/:id
export const updateTrade = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const oldTrade = await Trade.findOne({ _id: req.params.id, clerkId });
    if (!oldTrade) {
      return res.status(404).json({ error: "Trade not found" });
    }
    
    const trade = await Trade.findOneAndUpdate(
      { _id: req.params.id, clerkId },
      req.body,
      { new: true, runValidators: true }
    );
    
    if (oldTrade.strategy && trade?.strategy && oldTrade.strategy.toString() !== trade.strategy.toString()) {
       await syncStrategyStats(clerkId, oldTrade.strategy);
       await syncStrategyStats(clerkId, trade.strategy);
    } else if (trade?.strategy) {
       await syncStrategyStats(clerkId, trade.strategy);
    }
    
    res.json(trade);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// DELETE /api/trades/:id
export const deleteTrade = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const trade = await Trade.findOneAndDelete({ _id: req.params.id, clerkId });
    if (!trade) {
      return res.status(404).json({ error: "Trade not found" });
    }
    
    if (trade.strategy) {
       await syncStrategyStats(clerkId, trade.strategy);
    }
    
    res.json({ message: "Trade deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
