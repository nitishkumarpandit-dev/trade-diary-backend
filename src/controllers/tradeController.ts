import { Request, Response } from "express";
import mongoose from "mongoose";
import { Trade } from "../models/Trade";
import { Strategy } from "../models/Strategy";

import { getUserId, handleApiError } from "../utils/auth";

import { TradeService } from "../services/trade.service";

// GET /api/trades
export const getTrades = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);

    const filter: any = { clerkId };

    if (req.query.marketType && req.query.marketType !== "All") {
      if (req.query.marketType === "Crypto") {
        // Delta Sync uses descriptive sub-types; ensure they are caught in the global 'Crypto' bucket
        filter.marketType = { $in: ["Crypto", "Perpetual Futures", "Futures", "Call Option", "Put Option", "Move Option"] };
      } else {
        filter.marketType = req.query.marketType;
      }
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
        return res.status(400).json({ error: "Invalid strategy filter." });
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
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();

    // Bind UI-focused business logic computations to the server boundary
    const formattedTrades = rawTrades.map(TradeService.formatTrade);

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
    handleApiError(error, res);
  }
};

// GET /api/trades/:id
export const getTrade = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const trade = await Trade.findOne({ _id: req.params.id, clerkId })
      .populate("strategy")
      .populate("rules")
      .populate("mistakes")
      .lean();

    if (!trade) {
      return res.status(404).json({ error: "Trade not found" });
    }
    res.json(trade);
  } catch (error: any) {
    handleApiError(error, res);
  }
};

// POST /api/trades
export const createTrade = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);

    const {
      symbol,
      direction,
      entryDate,
      exitDate,
      entryPrice,
      exitPrice,
      size,
      fees,
      pnl,
      netPnl,
      notes,
      strategy,
      rules,
      mistakes,
      marketType,
      outcome,
      duration,
      roi,
      conviction,
      tags
    } = req.body;

    const payload = {
      clerkId,
      symbol,
      direction,
      entryDate,
      exitDate,
      entryPrice,
      exitPrice,
      size,
      fees,
      pnl,
      netPnl,
      notes,
      strategy,
      rules,
      mistakes,
      marketType,
      outcome,
      duration,
      roi,
      conviction,
      tags
    };

    const trade = new Trade(payload);
    await trade.save();

    if (trade.strategy) {
      await TradeService.syncStrategyStats(clerkId, trade.strategy);
    }

    res.status(201).json(trade);
  } catch (error: any) {
    handleApiError(error, res);
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

    const {
      symbol,
      direction,
      entryDate,
      exitDate,
      entryPrice,
      exitPrice,
      size,
      fees,
      pnl,
      netPnl,
      notes,
      strategy,
      rules,
      mistakes,
      marketType,
      outcome,
      duration,
      roi,
      conviction,
      tags
    } = req.body;

    const payload = {
      symbol,
      direction,
      entryDate,
      exitDate,
      entryPrice,
      exitPrice,
      size,
      fees,
      pnl,
      netPnl,
      notes,
      strategy,
      rules,
      mistakes,
      marketType,
      outcome,
      duration,
      roi,
      conviction,
      tags
    };

    // Remove undefined fields so they aren't incorrectly unset by $set
    Object.keys(payload).forEach(key => {
      if ((payload as any)[key] === undefined) {
        delete (payload as any)[key];
      }
    });

    const updateOps: any = { $set: payload };

    const trade = await Trade.findOneAndUpdate(
      { _id: req.params.id, clerkId },
      updateOps,
      { new: true, runValidators: true }
    );

    if (oldTrade.strategy && trade?.strategy && oldTrade.strategy.toString() !== trade.strategy.toString()) {
      await TradeService.syncStrategyStats(clerkId, oldTrade.strategy);
      await TradeService.syncStrategyStats(clerkId, trade.strategy);
    } else if (trade?.strategy) {
      await TradeService.syncStrategyStats(clerkId, trade.strategy);
    }

    res.json(trade);
  } catch (error: any) {
    handleApiError(error, res);
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
      await TradeService.syncStrategyStats(clerkId, trade.strategy);
    }

    res.json({ message: "Trade deleted successfully" });
  } catch (error: any) {
    handleApiError(error, res);
  }
};
