import mongoose, { Document, Schema, Model } from "mongoose";

export interface IRule extends Document {
  clerkId: string;
  name: string;
  category: "Psychology" | "Risk Management" | "Technical Setup" | "Execution" | "Analysis";
  description: string;
  isActive: boolean;
  adherenceCount: number;
  totalTrades: number;
  createdAt: Date;
  updatedAt: Date;
}

const RuleSchema = new Schema<IRule>(
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
    category: {
      type: String,
      enum: ["Psychology", "Risk Management", "Technical Setup", "Execution", "Analysis"],
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    adherenceCount: {
      type: Number,
      default: 0,
    },
    totalTrades: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const Rule: Model<IRule> =
  mongoose.models.Rule || mongoose.model<IRule>("Rule", RuleSchema);
