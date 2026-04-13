import { Request, Response } from "express";
import { Rule } from "../models/Rule";

const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

// GET /api/rules
export const getRules = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const rules = await Rule.find({ clerkId }).sort({ createdAt: -1 });
    res.json(rules);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/rules/:id
export const getRule = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const rule = await Rule.findOne({ _id: req.params.id, clerkId });
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }
    res.json(rule);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// POST /api/rules
export const createRule = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const rule = new Rule({ ...req.body, clerkId });
    await rule.save();
    res.status(201).json(rule);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// PATCH /api/rules/:id
export const updateRule = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const rule = await Rule.findOneAndUpdate(
      { _id: req.params.id, clerkId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }
    res.json(rule);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// DELETE /api/rules/:id
export const deleteRule = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const rule = await Rule.findOneAndDelete({ _id: req.params.id, clerkId });
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }
    res.json({ message: "Rule deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
