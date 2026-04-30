import mongoose from "mongoose";
import { Trade } from "../models/Trade";
import { Strategy } from "../models/Strategy";

export class TradeService {
  static async syncStrategyStats(clerkId: string, strategyId: any) {
    if (!strategyId) return;
    try {
      const stats = await Trade.aggregate([
        { $match: { clerkId, strategy: new mongoose.Types.ObjectId(strategyId.toString()) } },
        {
          $group: {
            _id: "$strategy",
            tradesExecuted: { $sum: 1 },
            netPnl: { $sum: "$pnl" },
            wins: {
              $sum: { $cond: [{ $eq: ["$outcome", "PROFITABLE"] }, 1, 0] }
            },
            grossProfit: {
              $sum: { $cond: [{ $gt: ["$pnl", 0] }, "$pnl", 0] }
            },
            grossLoss: {
              $sum: { $cond: [{ $lt: ["$pnl", 0] }, { $abs: "$pnl" }, 0] }
            }
          }
        },
        {
          $project: {
            tradesExecuted: 1,
            netPnl: 1,
            winRate: {
              $cond: [
                { $gt: ["$tradesExecuted", 0] },
                { $multiply: [{ $divide: ["$wins", "$tradesExecuted"] }, 100] },
                0
              ]
            },
            profitFactor: {
              $cond: [
                { $eq: ["$grossLoss", 0] },
                { $cond: [{ $gt: ["$grossProfit", 0] }, 100, 0] },
                { $divide: ["$grossProfit", "$grossLoss"] }
              ]
            }
          }
        }
      ]);

      let updateData = { tradesExecuted: 0, netPnl: 0, winRate: 0, profitFactor: 0 };
      if (stats.length > 0) {
        updateData = stats[0];
      }

      await Strategy.findOneAndUpdate(
        { _id: strategyId, clerkId },
        { $set: updateData }
      );
    } catch (err) {
      console.error("Failed to sync strategy stats:", err);
    }
  }

  static formatTrade(trade: any) {
    const t = trade.toObject ? trade.toObject() : trade;

    const entryPrice = Number(t.entryPrice) || 0;
    const quantity = Number(t.quantity) || 0;
    
    const margin = (t.margin != null && t.margin !== 0) 
      ? t.margin 
      : (entryPrice * quantity);

    const pnlPercent = (t.pnlPercent != null && t.pnlPercent !== 0)
      ? t.pnlPercent
      : (margin > 0 ? (t.pnl / margin) * 100 : 0);

    let mappedOutcome = "BREAK EVEN";
    if (t.outcome === "PROFITABLE") mappedOutcome = "FULL SUCCESS";
    if (t.outcome === "LOSS") mappedOutcome = "MISTAKE";

    let formattedDate = t.entryDate;
    if (t.entryDate) {
      const dt = new Date(t.entryDate);
      if (!isNaN(dt.getTime())) {
        formattedDate = dt.toLocaleDateString("en-GB", { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
      }
    }

    return {
      ...t,
      id: t._id.toString(),
      date: formattedDate,
      time: t.entryTime || "00:00",
      market: ["Perpetual Futures", "Futures", "Call Option", "Put Option", "Move Option", "Interest Rate Swap"].includes(t.marketType) 
        ? "Crypto" 
        : t.marketType,
      pnlPercent: pnlPercent,
      margin: margin,
      charges: t.charges || 0,
      strategy: (t.strategy as any)?.name || "None",
      outcome: mappedOutcome,
      rrRatio: t.rrRatio || "1:1"
    };
  }
}
