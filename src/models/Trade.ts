import mongoose, { Document, Schema, Model } from "mongoose";

export interface ITrade extends Document {
  clerkId: string;
  symbol: string;
  marketType: string;
  direction: "LONG" | "SHORT";
  duration: "INTRADAY" | "SWING";
  entryDate: string;
  exitDate?: string;
  entryTime?: string;
  exitTime?: string;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  leverage: number;
  stopLoss: number | null;
  target: number | null;
  outcome: "PROFITABLE" | "BREAK_EVEN" | "LOSS" | "PENDING";
  pnl: number;
  pnlPercent: number;
  totalAmount: number;
  charges: number;
  margin: number;
  rrRatio: number;
  confidence: number;
  satisfaction: number;
  emotionalState: string;
  analysis: string;
  lessonsLearned: string;
  strategy: mongoose.Types.ObjectId;
  rules: mongoose.Types.ObjectId[];
  mistakes: mongoose.Types.ObjectId[];
  externalOrderId?: string;
  externalBroker?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TradeSchema = new Schema<ITrade>(
  {
    clerkId: {
      type: String,
      required: true,
      index: true,
    },
    symbol: {
      type: String,
      required: true,
      trim: true,
    },
    marketType: {
      type: String,
      enum: ["Indian", "Crypto", "Forex"],
      default: "Indian",
    },
    direction: {
      type: String,
      enum: ["LONG", "SHORT"],
      required: true,
    },
    duration: {
      type: String,
      enum: ["INTRADAY", "SWING"],
      required: true,
    },
    entryDate: { type: String, required: true },
    exitDate: { type: String },
    entryTime: { type: String },
    exitTime: { type: String },
    entryPrice: { type: Number, required: true },
    exitPrice: { type: Number },
    quantity: { type: Number, required: true },
    leverage: { type: Number, default: 1 },
    stopLoss: { type: Number },
    target: { type: Number },
    outcome: {
      type: String,
      enum: ["PROFITABLE", "BREAK_EVEN", "LOSS", "PENDING"],
      default: "PENDING",
    },
    pnl: { type: Number, default: 0 },
    rrRatio: { type: Number, default: 0 },
    confidence: { type: Number, default: 5 },
    satisfaction: { type: Number, default: 5 },
    emotionalState: { type: String, default: "" },
    analysis: { type: String, default: "" },
    lessonsLearned: { type: String, default: "" },
    strategy: {
      type: Schema.Types.ObjectId,
      ref: "Strategy",
    },
    rules: [
      {
        type: Schema.Types.ObjectId,
        ref: "Rule",
      },
    ],
    mistakes: [
      {
        type: Schema.Types.ObjectId,
        ref: "Mistake",
      },
    ],
    externalOrderId: {
      type: String,
      sparse: true,
      index: true,
    },
    externalBroker: {
      type: String,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes mapping to common queries
TradeSchema.index({ clerkId: 1, marketType: 1 });
TradeSchema.index({ clerkId: 1, createdAt: -1 });
TradeSchema.index(
  { externalOrderId: 1, clerkId: 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { externalOrderId: { $type: "string" } } 
  }
);

export const Trade: Model<ITrade> =
  mongoose.models.Trade || mongoose.model<ITrade>("Trade", TradeSchema);
