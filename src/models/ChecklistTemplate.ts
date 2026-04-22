import mongoose, { Document, Schema, Model } from "mongoose";

export interface IChecklistTemplate extends Document {
  clerkId: string;
  title: string;
  category: string;
  type: "pre" | "post";
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const ChecklistTemplateSchema = new Schema<IChecklistTemplate>(
  {
    clerkId: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["pre", "post"],
      required: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

ChecklistTemplateSchema.index({ clerkId: 1, type: 1, order: 1 });

export const ChecklistTemplate: Model<IChecklistTemplate> =
  mongoose.models.ChecklistTemplate ||
  mongoose.model<IChecklistTemplate>("ChecklistTemplate", ChecklistTemplateSchema);
