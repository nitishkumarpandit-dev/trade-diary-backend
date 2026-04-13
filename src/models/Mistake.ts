import mongoose, { Document, Schema, Model } from "mongoose";

export interface IMistake extends Document {
  clerkId: string;
  name: string;
  category: "Psychology" | "Entry" | "Exit" | "Risk" | "Strategy" | "Other";
  severity: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  impact: "CRITICAL" | "MODERATE" | "GOOD";
  occurrences: number;
  pnlImpact: number;
  createdAt: Date;
  updatedAt: Date;
}

const MistakeSchema = new Schema<IMistake>(
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
      enum: ["Psychology", "Entry", "Exit", "Risk", "Strategy", "Other"],
      required: true,
    },
    severity: {
      type: String,
      enum: ["HIGH", "MEDIUM", "LOW", "NONE"],
      default: "MEDIUM",
    },
    impact: {
      type: String,
      enum: ["CRITICAL", "MODERATE", "GOOD"],
      default: "MODERATE",
    },
    occurrences: {
      type: Number,
      default: 0,
    },
    pnlImpact: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const Mistake: Model<IMistake> =
  mongoose.models.Mistake || mongoose.model<IMistake>("Mistake", MistakeSchema);
