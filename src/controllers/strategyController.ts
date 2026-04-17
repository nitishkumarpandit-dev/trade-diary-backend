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
    
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const skip = (page - 1) * limit;

    const strategies = await Strategy.find({ clerkId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await Strategy.countDocuments({ clerkId });

    // Ensure frontend compatibility mapping _id to id
    const formatted = strategies.map(s => {
      const obj = s.toObject ? s.toObject() : s;
      return { ...obj, id: obj._id.toString() };
    });

    res.json({
      data: formatted,
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
