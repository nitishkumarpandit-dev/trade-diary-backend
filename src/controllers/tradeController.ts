import { Request, Response } from "express";
import { Trade } from "../models/Trade";

const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
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
    
    // Note: In a production app you may want to parse bodies more strictly, 
    // and recalculate related strategy/mistakes counts here or async.
    const trade = new Trade({ ...req.body, clerkId });
    await trade.save();
    
    res.status(201).json(trade);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// PATCH /api/trades/:id
export const updateTrade = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const trade = await Trade.findOneAndUpdate(
      { _id: req.params.id, clerkId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!trade) {
      return res.status(404).json({ error: "Trade not found" });
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
    res.json({ message: "Trade deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
