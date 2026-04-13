import { Request, Response } from "express";
import { Mistake } from "../models/Mistake";

const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

// GET /api/mistakes
export const getMistakes = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const mistakes = await Mistake.find({ clerkId }).sort({ createdAt: -1 });
    res.json(mistakes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/mistakes/:id
export const getMistake = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const mistake = await Mistake.findOne({ _id: req.params.id, clerkId });
    if (!mistake) {
      return res.status(404).json({ error: "Mistake not found" });
    }
    res.json(mistake);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// POST /api/mistakes
export const createMistake = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const mistake = new Mistake({ ...req.body, clerkId });
    await mistake.save();
    res.status(201).json(mistake);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// PATCH /api/mistakes/:id
export const updateMistake = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const mistake = await Mistake.findOneAndUpdate(
      { _id: req.params.id, clerkId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!mistake) {
      return res.status(404).json({ error: "Mistake not found" });
    }
    res.json(mistake);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// DELETE /api/mistakes/:id
export const deleteMistake = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const mistake = await Mistake.findOneAndDelete({ _id: req.params.id, clerkId });
    if (!mistake) {
      return res.status(404).json({ error: "Mistake not found" });
    }
    res.json({ message: "Mistake deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
