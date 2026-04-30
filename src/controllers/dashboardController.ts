import { Request, Response } from "express";
import { Trade } from "../models/Trade";
import { Mistake } from "../models/Mistake";
import { Rule } from "../models/Rule";
import { Strategy } from "../models/Strategy";
import { DashboardService } from "../services/dashboard.service";

import { getUserId, handleApiError } from "../utils/auth";

export const getDashboardData = async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getUserId(req);

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

    // Controller delegates to the Service Layer
    const responseData = await DashboardService.getDashboardData(clerkId, matchQuery);

    res.status(200).json(responseData);
  } catch (error: any) {
    console.error("❌ Error fetching dashboard data:", error);
    handleApiError(error, res);
  }
};
