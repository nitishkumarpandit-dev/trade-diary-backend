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

    const filter: any = { clerkId };

    if (req.query.marketType && req.query.marketType !== "All") {
      filter.marketType = req.query.marketType;
    }

    if (req.query.direction && req.query.direction !== "Both") {
      filter.direction = (req.query.direction as string).toUpperCase();
    }

    if (req.query.outcome && req.query.outcome !== "All Outcomes") {
      const qOut = (req.query.outcome as string).toUpperCase();
      let dbOutcome = "PENDING";
      if (qOut === "MISTAKE" || qOut === "LOSS") dbOutcome = "LOSS";
      if (qOut === "FULL SUCCESS" || qOut === "PROFITABLE") dbOutcome = "PROFITABLE";
      if (qOut === "BREAK EVEN" || qOut === "BREAK_EVEN") dbOutcome = "BREAK_EVEN";

      if (["PROFITABLE", "LOSS", "BREAK_EVEN", "PENDING"].includes(qOut)) {
        dbOutcome = qOut;
      }
      filter.outcome = dbOutcome;
    }

    if (req.query.strategy && req.query.strategy !== "All" && req.query.strategy !== "") {
      const strat = await Strategy.findOne({ clerkId, name: req.query.strategy });
      if (strat) {
        filter.strategy = strat._id;
      } else {
        filter.strategy = new mongoose.Types.ObjectId();
      }
    }

    const sortQ = req.query.sort as string;
    let sortObj: any = { createdAt: -1 };
    if (sortQ === "Newest") sortObj = { createdAt: -1 };
    if (sortQ === "Oldest") sortObj = { createdAt: 1 };
    if (sortQ === "Highest PnL") sortObj = { pnl: -1 };
    if (sortQ === "Lowest PnL") sortObj = { pnl: 1 };

    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const skip = (page - 1) * limit;

    const rawTrades = await Trade.find(filter)
      .populate("strategy", "name")
      .populate("rules", "name category")
      .populate("mistakes", "name severity impact")
      .sort(sortObj)
      .skip(skip)
      .limit(limit);

    // Bind UI-focused business logic computations to the server boundary
    const formattedTrades = rawTrades.map(trade => {
      const t = trade.toObject ? trade.toObject() : trade;

      const ePrice = Number(t.entryPrice) || 0;
      const qty = Number(t.quantity) || 0;
      const margin = ePrice * qty;

      // Guard divide by 0
      const pnlPct = margin > 0 ? (t.pnl / margin) * 100 : 0;

      let mappedOutcome = "BREAK EVEN";
      if (t.outcome === "PROFITABLE") mappedOutcome = "FULL SUCCESS";
      if (t.outcome === "LOSS") mappedOutcome = "MISTAKE";

      let formattedDate = t.entryDate;
      if (t.entryDate) {
        const dt = new Date(t.entryDate);
        if (!isNaN(dt.getTime())) {
          formattedDate = dt.toLocaleDateString("en-GB", { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
        }
      }

      return {
        ...t,
        id: t._id.toString(),
        date: formattedDate,
        time: t.entryTime || "00:00",
        market: t.marketType,
        pnlPercent: pnlPct,
        strategy: (t.strategy as any)?.name || "None",
        outcome: mappedOutcome,
        rrRatio: t.rrRatio || "1:1"
      };
    });

    const totalCount = await Trade.countDocuments(filter);

    res.json({
      trades: formattedTrades,
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
