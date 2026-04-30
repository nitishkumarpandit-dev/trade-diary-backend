import { Request, Response } from "express";
import { Mistake } from "../models/Mistake";
import { Trade } from "../models/Trade";

import { getUserId, handleApiError } from "../utils/auth";

function deriveSeverity(name: string): "HIGH" | "MEDIUM" | "LOW" {
  const lower = name.toLowerCase();
  if (
    lower.includes("risk") ||
    lower.includes("loss") ||
    lower.includes("revenge")
  )
    return "HIGH";
  if (
    lower.includes("fomo") ||
    lower.includes("over") ||
    lower.includes("early")
  )
    return "MEDIUM";
  return "LOW";
}

function deriveImpact(severity: "HIGH" | "MEDIUM" | "LOW"): "CRITICAL" | "MODERATE" | "GOOD" {
  if (severity === "HIGH") return "CRITICAL";
  if (severity === "MEDIUM") return "MODERATE";
  return "GOOD";
}

export const getMistakeAnalytics = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const timeframeStr = (req.query.timeframe as string) || "All";
    
    const now = new Date();
    let startDate = new Date(0);
    if (timeframeStr === "This Month") {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    
    const dateStr = startDate.toISOString().split("T")[0];
    const filter: any = { clerkId };
    if (timeframeStr !== "All") {
      filter.entryDate = { $gte: dateStr };
    }
    
    const stats = await Trade.aggregate([
      { $match: filter },
      {
        $project: {
          mistakes: 1,
          entryDate: 1,
          mistakesLen: { $size: "$mistakes" }
        }
      },
      {
        $facet: {
           mistakeCounts: [
             { $unwind: "$mistakes" },
             { $group: { _id: "$mistakes", occurrences: { $sum: 1 } } }
           ],
           mistakesByDate: [
             { $match: { mistakesLen: { $gt: 0 } } },
             { $group: { _id: "$entryDate", count: { $sum: "$mistakesLen" } } }
           ]
        }
      }
    ]);
    
    const result = stats[0];
    const mistakeCountsAgg = result.mistakeCounts;
    const mistakesByDate = result.mistakesByDate;
    
    const heatmapData = Array.from({ length: 5 }, () => Array(7).fill(0));
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    mistakesByDate.forEach((d: any) => {
        const parts = d._id.split("-");
        if (parts.length === 3) {
            const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
            const daysDiff = Math.floor((todayDate.getTime() - dateObj.getTime()) / (1000 * 3600 * 24));
            if (daysDiff >= 0 && daysDiff < 35) {
                const week = 4 - Math.floor(daysDiff / 7);
                const col = 6 - (daysDiff % 7);
                if (week >= 0 && week < 5 && col >= 0 && col < 7) {
                    heatmapData[week][col] += d.count;
                }
            }
        }
    });
    
    // Normalize heatmap max to 4 intensity limit
    for (let w = 0; w < 5; w++) {
       for (let d = 0; d < 7; d++) {
           heatmapData[w][d] = Math.min(4, heatmapData[w][d]);
       }
    }
    
    const mistakes = await Mistake.find({ clerkId }).lean();
    const mistakeCounts: Record<string, number> = {};
    mistakeCountsAgg.forEach((m: any) => mistakeCounts[m._id.toString()] = m.occurrences);
    
    let totalMistakes = 0;
    const catCounts: Record<string, number> = {};
    
    const mappedMistakes = mistakes.map(m => {
       const count = mistakeCounts[m._id.toString()] || 0;
       totalMistakes += count;
       if (count > 0) {
           catCounts[m.category] = (catCounts[m.category] || 0) + count;
       }
       return {
         id: m._id,
         name: m.name,
         category: m.category,
         occurrences: count,
         severity: m.severity
       };
    }).filter(m => m.occurrences > 0);
    
    mappedMistakes.sort((a, b) => b.occurrences - a.occurrences);
    const mostCommon = mappedMistakes.length > 0 ? mappedMistakes[0] : null;
    
    const maxCat = Math.max(...Object.values(catCounts), 1);
    const categoryDistribution = Object.entries(catCounts).map(([cat, count]) => ({
      category: cat,
      count,
      pct: Math.round((count / maxCat) * 100)
    }));
    
    res.json({
        totalMistakes,
        mostCommon,
        categoryDistribution,
        heatmapData
    });

  } catch (error: any) {
    handleApiError(error, res);
  }
};

// GET /api/mistakes
export const getMistakes = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const skip = (page - 1) * limit;

    const mistakes = await Mistake.find({ clerkId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalCount = await Mistake.countDocuments({ clerkId });

    const formatted = mistakes.map(m => {
      const obj = m.toObject ? m.toObject() : m;
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
    handleApiError(error, res);
  }
};

// GET /api/mistakes/:id
export const getMistake = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const mistake = await Mistake.findOne({ _id: req.params.id, clerkId }).lean();
    if (!mistake) {
      return res.status(404).json({ error: "Mistake not found" });
    }
    res.json(mistake);
  } catch (error: any) {
    handleApiError(error, res);
  }
};

// POST /api/mistakes
export const createMistake = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const body = { ...req.body };
    if (body.name) {
      body.severity = deriveSeverity(body.name);
      body.impact = deriveImpact(body.severity);
    }
    const mistake = new Mistake({ ...body, clerkId });
    await mistake.save();
    res.status(201).json(mistake);
  } catch (error: any) {
    handleApiError(error, res);
  }
};

// PATCH /api/mistakes/:id
export const updateMistake = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const updateData = { ...req.body };
    if (updateData.name) {
      updateData.severity = deriveSeverity(updateData.name);
      updateData.impact = deriveImpact(updateData.severity);
    }
    const mistake = await Mistake.findOneAndUpdate(
      { _id: req.params.id, clerkId },
      updateData,
      { new: true, runValidators: true }
    );
    if (!mistake) {
      return res.status(404).json({ error: "Mistake not found" });
    }
    res.json(mistake);
  } catch (error: any) {
    handleApiError(error, res);
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
    handleApiError(error, res);
  }
};
