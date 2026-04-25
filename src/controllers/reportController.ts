import { Request, Response } from "express";
import { Trade } from "../models/Trade";
import { Strategy } from "../models/Strategy";

export const getReportData = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = (req as any).auth?.userId;
    if (!clerkId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { marketType, duration } = req.query;

    const matchQuery: any = { clerkId };

    if (marketType && marketType !== "Indian") {
       // FilterBar passes 'Indian' but we save it as 'Indian'.
       // Note: 'Crypto' and 'Forex' can be passed.
       matchQuery.marketType = marketType;
    }

    if (duration) {
      const now = new Date();
      let startDate = new Date();
      
      switch (duration) {
        case "Last 30 Days":
          startDate.setDate(now.getDate() - 30);
          break;
        case "Last 90 Days":
          startDate.setDate(now.getDate() - 90);
          break;
        case "Last 1 Year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 30);
      }
      
      matchQuery.createdAt = { $gte: startDate };
    }

    // Fetch all applicable trades and populate fields
    const trades = await Trade.find({ ...matchQuery, outcome: { $ne: "PENDING" } })
      .populate("strategy", "name")
      .lean();

    // PERFORMANCE METRICS
    let wins = 0;
    let losses = 0;
    let be = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;
    let bestDayPnl = -Infinity;
    let worstDayPnl = Infinity;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let totalCapital = 0;
    let symbolCounts: Record<string, { trades: number, pnl: number, wins: number }> = {};
    let dailyPnl: Record<string, number> = {};
    let strategyEffectiveness: Record<string, { wins: number, total: number }> = {};
    
    // PSYCHOLOGY
    let emotionFreq: Record<string, number> = {};
    let emotionRR: Record<string, { totalRR: number, count: number }> = {};

    // RISK & JOURNAL
    let totalNegativePnl = 0;
    let negativePnlCount = 0;
    let targetAchievedCount = 0;
    let stoppedBeforeTargetCount = 0;
    
    let maxDrawdown = 0;
    let peakPnl = 0;
    let cumulativePnl = 0;

    // Execution metrics
    let fullSuccess = 0;
    let partialSuccess = 0;
    let followedPlan = 0;
    let mistakeCount = 0;

    let dailyNetPnl: { date: string; value: number }[] = [];

    // Sort trades chronologically for drawdown & streak calculation
    trades.sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());

    trades.forEach((t: any) => {
      const pnl = t.pnl || 0;
      const capital = (t.entryPrice || 0) * (t.quantity || 0);
      totalCapital += capital;
      
      // Streak and Win/Loss
      if (t.outcome === "PROFITABLE") {
        wins++;
        totalWinPnl += pnl;
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
      } else if (t.outcome === "LOSS") {
        losses++;
        totalLossPnl += pnl;
        totalNegativePnl += pnl;
        negativePnlCount++;
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
      } else {
        be++;
        currentWinStreak = 0;
        currentLossStreak = 0;
      }

      // Drawdown
      cumulativePnl += pnl;
      if (cumulativePnl > peakPnl) peakPnl = cumulativePnl;
      const drawdown = peakPnl - cumulativePnl;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      // Symbol
      const sym = t.symbol || "UNKNOWN";
      if (!symbolCounts[sym]) symbolCounts[sym] = { trades: 0, pnl: 0, wins: 0 };
      symbolCounts[sym].trades++;
      symbolCounts[sym].pnl += pnl;
      if (t.outcome === "PROFITABLE") symbolCounts[sym].wins++;

      // Daily PNL
      const dayKey = t.entryDate || t.createdAt?.toISOString().split('T')[0];
      if (!dailyPnl[dayKey]) dailyPnl[dayKey] = 0;
      dailyPnl[dayKey] += pnl;

      // Strategy
      const stratName = t.strategy?.name || "Uncategorized";
      if (!strategyEffectiveness[stratName]) strategyEffectiveness[stratName] = { wins: 0, total: 0 };
      strategyEffectiveness[stratName].total++;
      if (t.outcome === "PROFITABLE") strategyEffectiveness[stratName].wins++;

      // Emotion
      const emotion = t.emotionalState || "Calm";
      emotionFreq[emotion] = (emotionFreq[emotion] || 0) + 1;
      
      const rr = t.rrRatio || 0;
      if (!emotionRR[emotion]) emotionRR[emotion] = { totalRR: 0, count: 0 };
      emotionRR[emotion].totalRR += rr;
      emotionRR[emotion].count++;

      // Journal
      if (t.target) {
        if (t.direction === "LONG" && t.exitPrice && t.exitPrice >= t.target) targetAchievedCount++;
        else if (t.direction === "SHORT" && t.exitPrice && t.exitPrice <= t.target) targetAchievedCount++;
        else if (t.exitPrice && t.exitPrice > 0) stoppedBeforeTargetCount++;
      }

      // Execution (approximated from rules/mistakes)
      const rulesLen = Array.isArray(t.rules) ? t.rules.length : 0;
      const mistakesLen = Array.isArray(t.mistakes) ? t.mistakes.length : 0;
      
      if (rulesLen > 0 && mistakesLen === 0) fullSuccess++;
      else if (mistakesLen > 0) mistakeCount++;
      else if (rulesLen > 0) followedPlan++;
      else partialSuccess++; // Fallback
    });

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const avgWin = wins > 0 ? totalWinPnl / wins : 0;
    const avgLoss = losses > 0 ? totalLossPnl / losses : 0; // negative value
    const expectancy = (winRate / 100) * avgWin + ((100 - winRate) / 100) * avgLoss;

    let avgWinDay = 0;
    let avgLossDay = 0;
    let winDays = 0;
    let lossDays = 0;

    Object.entries(dailyPnl).forEach(([date, pnl]) => {
      dailyNetPnl.push({ date, value: pnl });
      if (pnl > bestDayPnl) bestDayPnl = pnl;
      if (pnl < worstDayPnl) worstDayPnl = pnl;
      if (pnl > 0) { winDays++; avgWinDay += pnl; }
      else if (pnl < 0) { lossDays++; avgLossDay += pnl; }
    });

    if (bestDayPnl === -Infinity) bestDayPnl = 0;
    if (worstDayPnl === Infinity) worstDayPnl = 0;
    if (winDays > 0) avgWinDay /= winDays;
    if (lossDays > 0) avgLossDay /= lossDays;

    dailyNetPnl.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Symbol analysis
    let mostTraded = "-";
    let mostProfitable = "-";
    let leastProfitable = "-";
    let highestWinRate = "-";
    let maxSymbolTrades = 0;
    let maxSymbolPnl = -Infinity;
    let minSymbolPnl = Infinity;
    let maxSymbolWinRate = 0;

    Object.entries(symbolCounts).forEach(([sym, stats]) => {
      if (stats.trades > maxSymbolTrades) { maxSymbolTrades = stats.trades; mostTraded = sym; }
      if (stats.pnl > maxSymbolPnl) { maxSymbolPnl = stats.pnl; mostProfitable = sym; }
      if (stats.pnl < minSymbolPnl) { minSymbolPnl = stats.pnl; leastProfitable = sym; }
      const wr = (stats.wins / stats.trades) * 100;
      if (wr > maxSymbolWinRate && stats.trades >= 3) { maxSymbolWinRate = wr; highestWinRate = sym; }
    });

    if (highestWinRate === "-" && mostTraded !== "-") highestWinRate = mostTraded;

    const avgCapital = totalTrades > 0 ? totalCapital / totalTrades : 0;
    const totalDays = Object.keys(dailyPnl).length;
    const avgTradesPerDay = totalDays > 0 ? totalTrades / totalDays : 0;

    // Format Strategy Effectiveness
    const setupEffectiveness = Object.entries(strategyEffectiveness).map(([name, stats]) => ({
      name,
      winRate: (stats.wins / stats.total) * 100
    })).sort((a, b) => b.winRate - a.winRate);

    // Format Emotion Frequency
    const emotionData = Object.entries(emotionFreq).map(([name, count]) => ({
      name,
      percentage: (count / totalTrades) * 100
    }));

    // Format Emotion R:R
    const emotionRRData = Object.entries(emotionRR).map(([name, stats]) => ({
      name,
      avgRR: stats.count > 0 ? stats.totalRR / stats.count : 0
    }));

    const response = {
      performance: {
        wins,
        losses,
        be,
        avgWin,
        avgLoss,
        winRate,
        expectancy,
        bestDay: bestDayPnl,
        worstDay: worstDayPnl,
        avgWinDay,
        avgLossDay,
        totalTrades,
        avgCapital,
        bestStrategy: setupEffectiveness.length > 0 ? setupEffectiveness[0].name : "-",
        streakW: maxWinStreak,
        streakL: maxLossStreak,
        setupEffectiveness,
        mostTraded,
        mostProfitable,
        leastProfitable,
        highestWinRate,
        avgTradesPerDay,
      },
      psychology: {
        emotionFreq: emotionData,
        emotionRR: emotionRRData,
      },
      risk: {
        realizedRR: avgLoss < 0 ? Math.abs(avgWin / avgLoss) : 0, // Approx
        avgLoss: avgLoss,
        maxDrawdown,
        expectancy,
      },
      journal: {
        targetAchievedCount,
        stoppedBeforeTargetCount,
        totalTrades,
        fullSuccess,
        partialSuccess,
        followedPlan,
        mistakeCount,
        dailyNetPnl,
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("❌ Error fetching report data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
