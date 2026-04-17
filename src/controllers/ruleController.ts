import { Request, Response } from "express";
import { Rule } from "../models/Rule";
import { Trade } from "../models/Trade";

const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

export const getRuleAnalytics = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const timeframeStr = (req.query.timeframe as string) || "All Time";
    
    const now = new Date();
    let startDate = new Date(0);
    if (timeframeStr === "Last 7 Days") {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeframeStr === "Last 30 Days") {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    
    const dateStr = startDate.toISOString().split("T")[0];
    const filter: any = { clerkId };
    if (timeframeStr !== "All Time") {
      filter.entryDate = { $gte: dateStr };
    }
    
    // Efficiently calculate all metrics using MongoDB aggregation
    const stats = await Trade.aggregate([
      { $match: filter },
      {
        $project: {
           rules: 1,
           mistakes: 1,
           entryDate: 1,
           rulesLen: { $size: "$rules" },
           mistakesLen: { $size: "$mistakes" },
        }
      },
      {
        $addFields: {
           bothLen: { $add: ["$rulesLen", "$mistakesLen"] },
           parsedDate: { $dateFromString: { dateString: "$entryDate", format: "%Y-%m-%d", onError: null } }
        }
      },
      {
        $addFields: {
           disciplineScore: {
             $cond: [
               { $gt: ["$bothLen", 0] },
               { $multiply: [{ $divide: ["$rulesLen", "$bothLen"] }, 100] },
               0
             ]
           },
           dayOfWeek: { $dayOfWeek: "$parsedDate" }
        }
      },
      {
        $facet: {
          total: [ { $count: "count" } ],
          ruleCounts: [
            { $unwind: "$rules" },
            { $group: { _id: "$rules", adherenceCount: { $sum: 1 } } }
          ],
          disciplineByDay: [
            { $match: { bothLen: { $gt: 0 } } },
            { $group: { _id: "$dayOfWeek", sum: { $sum: "$disciplineScore" }, count: { $sum: 1 } } }
          ]
        }
      }
    ]);

    const result = stats[0];
    const totalTrades = result.total.length > 0 ? result.total[0].count : 0;
    const ruleCountsAgg = result.ruleCounts;
    const disciplineByDay = result.disciplineByDay;

    const rules = await Rule.find({ clerkId });

    const ruleCounts: Record<string, number> = {};
    ruleCountsAgg.forEach((r: any) => ruleCounts[r._id.toString()] = r.adherenceCount);

    const mappedRules = rules.map(r => ({
         id: r._id,
         name: r.name,
         category: r.category,
         adherenceCount: ruleCounts[r._id.toString()] || 0,
         totalTrades
    })).filter(r => r.totalTrades > 0 && r.adherenceCount > 0);
    
    mappedRules.sort((a, b) => b.adherenceCount - a.adherenceCount);
    const topFollowed = mappedRules.slice(0, 5);
    const leastUsed = [...mappedRules].sort((a, b) => a.adherenceCount - b.adherenceCount).slice(0, 3);
    
    const disciplineData = [0, 0, 0, 0, 0, 0, 0];
    // MongoDB dayOfWeek: 1=Sun, 2=Mon... 7=Sat. Mock Index: Mon=0 ... Sun=6.
    const getMockIndex = (mongoDay: number) => mongoDay === 1 ? 6 : mongoDay - 2;
    
    disciplineByDay.forEach((d: any) => {
        if (d._id && d.count > 0) {
            disciplineData[getMockIndex(d._id)] = Math.round(d.sum / d.count);
        }
    });

    res.json({
        topFollowed,
        leastUsed,
        disciplineData
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/rules
export const getRules = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const skip = (page - 1) * limit;

    const rules = await Rule.find({ clerkId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await Rule.countDocuments({ clerkId });

    const formatted = rules.map(r => {
      const obj = r.toObject ? r.toObject() : r;
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
