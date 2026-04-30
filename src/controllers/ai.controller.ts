import { Request, Response } from "express";
import { Trade } from "../models/Trade";
import { generateTradeInsights } from "../services/gemini.service";

import { getUserId, handleApiError } from "../utils/auth";

export const getInsights = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const { targetMarket, period, startDate, endDate } = req.body;

    const filter: any = { clerkId };

    if (targetMarket && targetMarket !== "All") {
      if (targetMarket === "Crypto") {
        filter.marketType = { $in: ["Crypto", "Perpetual Futures", "Futures", "Call Option", "Put Option", "Move Option"] };
      } else {
        filter.marketType = targetMarket;
      }
    }

    // Handle date filtering if custom range or period is provided
    if (period === 'Custom' && startDate && endDate) {
      filter.entryDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else if (period && !isNaN(Number(period))) {
      const days = parseInt(period, 10);
      const dateOffset = new Date();
      dateOffset.setDate(dateOffset.getDate() - days);
      filter.entryDate = { $gte: dateOffset };
    }

    // Fetch the trades (limit to 100 most recent to avoid massive payloads to Gemini)
    const rawTrades = await Trade.find(filter)
      .populate("strategy", "name")
      .sort({ createdAt: -1 })
      .limit(100);

    if (rawTrades.length === 0) {
      return res.status(400).json({ error: "No trades found for this period to analyze." });
    }

    const insights = await generateTradeInsights(rawTrades);

    res.json(insights);
  } catch (error: any) {
    handleApiError(error, res);
  }
};
