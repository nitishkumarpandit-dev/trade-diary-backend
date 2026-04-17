import { Request, Response } from "express";
import { Mistake } from "../models/Mistake";
import { Trade } from "../models/Trade";

const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

// GET /api/mistakes/analytics
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
    
    const [trades, mistakes] = await Promise.all([
      Trade.find(filter),
      Mistake.find({ clerkId })
    ]);
    
    const mistakeCounts: Record<string, number> = {};
    mistakes.forEach(m => mistakeCounts[m._id.toString()] = 0);
    
    const heatmapData = Array.from({ length: 5 }, () => Array(7).fill(0));
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    trades.forEach(trade => {
       // Tally mistakes
       trade.mistakes.forEach((mistakeId: any) => {
         const id = mistakeId.toString();
         if (mistakeCounts[id] !== undefined) mistakeCounts[id]++;
       });
       
       // Calculate heatmap mapped to last 35 days
       if (trade.mistakes.length > 0) {
           const parts = trade.entryDate.split("-");
           if (parts.length === 3) {
               const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
               const daysDiff = Math.floor((todayDate.getTime() - d.getTime()) / (1000 * 3600 * 24));
               if (daysDiff >= 0 && daysDiff < 35) {
                   const week = 4 - Math.floor(daysDiff / 7);
                   const col = 6 - (daysDiff % 7);
                   if (week >= 0 && week < 5 && col >= 0 && col < 7) {
                       heatmapData[week][col] += trade.mistakes.length;
                   }
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
    res.status(500).json({ error: error.message });
  }
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
