import mongoose,{ Document, Schema, Model } from "mongoose";

export interface IStrategy extends Document {
  clerkId: string;
  name: string;
  description: string;
  isActive: boolean;
  icon: string;
  duration?: string;
  winRate: number;
  profitFactor: number;
  riskPerTrade: number;
  netPnl: number;
  tradesExecuted: number;
  rrRatio: string;
  createdAt: Date;
  updatedAt: Date;
}

const StrategySchema = new Schema<IStrategy>(
  {
    clerkId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    icon: {
      type: String,
      default: "strategy",
    },
    duration: {
      type: String,
      default: "Intraday",
    },
    winRate: {
      type: Number,
      default: 0,
    },
    profitFactor: {
      type: Number,
      default: 0,
    },
    riskPerTrade: {
      type: Number,
      default: 1,
    },
    netPnl: {
      type: Number,
      default: 0,
    },
    tradesExecuted: {
      type: Number,
      default: 0,
    },
    rrRatio: {
      type: String,
      default: "1:1",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
StrategySchema.index({ clerkId: 1, name: 1 });

export const Strategy: Model<IStrategy> =
  mongoose.models.Strategy || mongoose.model<IStrategy>("Strategy", StrategySchema);
