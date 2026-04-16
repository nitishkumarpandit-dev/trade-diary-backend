import { Request, Response } from "express";
import { Rule } from "../models/Rule";
import { Trade } from "../models/Trade";

const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

// GET /api/rules/analytics
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
    
    const [trades, rules] = await Promise.all([
      Trade.find(filter),
      Rule.find({ clerkId })
    ]);
    
    const ruleCounts: Record<string, number> = {};
    const totalTrades = trades.length;
    rules.forEach(r => ruleCounts[r._id.toString()] = 0);
    
    let dayDisciplineSum = [0, 0, 0, 0, 0, 0, 0];
    let dayTradeCount = [0, 0, 0, 0, 0, 0, 0];
    
    trades.forEach(trade => {
       trade.rules.forEach((ruleId: any) => {
         const id = ruleId.toString();
         if (ruleCounts[id] !== undefined) ruleCounts[id]++;
       });
       
       const rulesLen = trade.rules.length;
       const mistakesLen = trade.mistakes.length;
       let disciplineScore = 0;
       
       if (rulesLen > 0 || mistakesLen > 0) {
           disciplineScore = (rulesLen / (rulesLen + mistakesLen)) * 100;
           
           const parts = trade.entryDate.split("-");
           if (parts.length === 3) {
             const date = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
             const day = date.getDay(); 
             dayDisciplineSum[day] += disciplineScore;
             dayTradeCount[day]++;
           }
       }
    });
    
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
    const jsDayToMockIndex = [6, 0, 1, 2, 3, 4, 5];
    
    for (let i=0; i<7; i++) {
        if (dayTradeCount[i] > 0) {
            disciplineData[jsDayToMockIndex[i]] = Math.round(dayDisciplineSum[i] / dayTradeCount[i]);
        }
    }
    
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
