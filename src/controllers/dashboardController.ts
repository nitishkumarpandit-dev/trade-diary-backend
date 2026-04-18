import { Request, Response } from "express";
import { Trade } from "../models/Trade";
import { Mistake } from "../models/Mistake";
import { Rule } from "../models/Rule";
import { Strategy } from "../models/Strategy";

export const getDashboardData = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = (req as any).auth?.userId;
    if (!clerkId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { marketType, range } = req.query;

    const matchQuery: any = { clerkId };

    if (marketType && marketType !== "All") {
      matchQuery.marketType = marketType;
    }

    if (range) {
      const now = new Date();
      let startDate = new Date();
      
      switch (range) {
        case "Last 7 Days":
          startDate.setDate(now.getDate() - 7);
          break;
        case "Last 30 Days":
          startDate.setDate(now.getDate() - 30);
          break;
        case "Last 1 Year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate = new Date(0); // All time
      }
      
      // If we want all time, skip the createdAt filter unless it's strictly Last X Days
      if (range !== "All Time" && range !== "All") {
         matchQuery.createdAt = { $gte: startDate };
      }
    }

    // 1. Core Analytics via Aggregation
    const tradeStatsObj = await Trade.aggregate([
      { $match: { ...matchQuery, outcome: { $ne: "PENDING" } } },
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ["$outcome", "PROFITABLE"] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ["$outcome", "LOSS"] }, 1, 0] } },
          highestPnl: { $max: "$pnl" }
        }
      }
    ]);

    const stats = tradeStatsObj[0] || { totalTrades: 0, wins: 0, losses: 0, highestPnl: 0 };
    const winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : 0;

    // 2. Auxiliary Insights
    const [strategiesCount, rulesCount, mistakesCount] = await Promise.all([
      Strategy.countDocuments({ clerkId, isActive: true }),
      Rule.countDocuments({ clerkId, isActive: true }),
      Mistake.countDocuments({ clerkId })
    ]);

    const formatTrade = (t: any) => {
      const pnl = t.pnl || 0;
      const d = new Date(t.entryDate || t.createdAt);
      return {
        id: t._id.toString(),
        date: d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }).toUpperCase(),
        time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        symbol: t.symbol || "UNKNOWN",
        direction: t.direction || "LONG",
        pnl: pnl,
        pnlPercent: t.pnlPercent || 0, // Fallback if no percent available natively
        entryPrice: t.entryPrice || 0,
        exitPrice: t.exitPrice || 0,
        strategy: t.strategy?.name || "Uncategorized",
        rrRatio: t.strategy?.rrRatio ? `1:${t.strategy.rrRatio}` : "1:2.0",
        outcome: t.outcome || "BREAK EVEN",
        market: "Crypto", // Mock fallback explicitly aligning history payload schema safely
      };
    };

    // 3. Top Trades
    const topTradesRaw = await Trade.find({ ...matchQuery, outcome: { $ne: "PENDING" } })
      .sort({ pnl: -1 })
      .limit(3)
      .populate("strategy", "name rrRatio")
      .lean();

    // 4. Recent Trades
    const recentTradesRaw = await Trade.find(matchQuery)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("strategy", "name rrRatio")
      .lean();

    // 5. Common Mistakes
    const commonMistakesRaw = await Mistake.find({ clerkId })
      .sort({ occurrences: -1 })
      .limit(2)
      .lean();

    const commonMistakes = commonMistakesRaw.map(m => ({
      id: m._id.toString(),
      title: m.name,
      occurrences: m.occurrences,
      pnl: `-$${Math.abs(m.pnlImpact || 0).toFixed(2)}`,
      severity: m.severity === 'HIGH' ? 'CRITICAL' : 'WARNING'
    }));

    // 6. Cumulative Chart & Strategy Analytics
    const allChartTradesRaw = await Trade.find({ ...matchQuery, outcome: { $ne: "PENDING" } })
      .sort({ entryDate: 1 })
      .populate("strategy", "name")
      .lean();

    const buildChartData = (trades: any[]) => {
      const dailyMap = new Map<string, number>();
      const weeklyMap = new Map<string, number>();
      const monthlyMap = new Map<string, number>();
      const strategyMap = new Map<string, number>();

      trades.forEach((t) => {
        const d = new Date(t.entryDate || t.createdAt);
        const pnl = t.pnl || 0;

        // Daily Key: YYYY-MM-DD
        const dayKey = d.toISOString().split('T')[0];
        dailyMap.set(dayKey, (dailyMap.get(dayKey) || 0) + pnl);

        // Weekly Key: Start of Week (Monday)
        const wd = new Date(d);
        const day = wd.getDay();
        const diff = wd.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(wd.setDate(diff));
        const weekKey = monday.toISOString().split('T')[0];
        weeklyMap.set(weekKey, (weeklyMap.get(weekKey) || 0) + pnl);

        // Monthly Key: YYYY-MM
        const monthKey = dayKey.substring(0, 7);
        monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + pnl);
        
        // Strategy Key
        const stratName = t.strategy?.name || "Uncategorized";
        strategyMap.set(stratName, (strategyMap.get(stratName) || 0) + pnl);
      });

      const accumulate = (map: Map<string, number>) => {
        let runningTotal = 0;
        return Array.from(map.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, val]) => {
            runningTotal += val;
            return { date, value: Number(runningTotal.toFixed(2)) };
          });
      };

      const strategyPnL = Array.from(strategyMap.entries()).map(([strategy, value]) => ({
        strategy,
        pnl: Number(value.toFixed(2))
      }));

      return {
        chartData: {
          daily: accumulate(dailyMap),
          weekly: accumulate(weeklyMap),
          monthly: accumulate(monthlyMap)
        },
        strategyPnL
      };
    };

    const analyticsData = buildChartData(allChartTradesRaw);

    // Construct Payload
    const responseData = {
      stats: {
        highestPnl: `+$${(stats.highestPnl || 0).toFixed(2)}`,
        winRate: `${winRate.toFixed(1)}%`,
        avgRR: "1:2.0",
        totalTrades: `${stats.totalTrades}`
      },
      confidence: {
        index: Math.round(winRate),
        label: winRate >= 50 ? "High Confidence" : "Review Required",
        description: winRate >= 50 ? "Strong consistent performance." : "Focus strictly on your setup rules."
      },
      insights: {
        strategies: `${strategiesCount} active`,
        rules: `${rulesCount} tracked`,
        mistakes: `${mistakesCount} logged`
      },
      topTrades: topTradesRaw.map(formatTrade),
      winLossDist: {
        wins: stats.wins,
        losses: stats.losses,
        winRate: Math.round(winRate)
      },
      commonMistakes,
      tradeHistory: recentTradesRaw.map(formatTrade),
      chartData: analyticsData.chartData,
      strategyPnL: analyticsData.strategyPnL
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("❌ Error fetching dashboard data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
