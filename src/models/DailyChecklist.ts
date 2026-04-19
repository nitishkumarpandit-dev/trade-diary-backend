import mongoose, { Document, Schema, Model } from "mongoose";

export interface IDailyChecklistItem {
  templateId: string;
  title: string;
  category: string;
  type: "pre" | "post";
  completed: boolean;
}

export interface IDailyChecklist extends Document {
  clerkId: string;
  date: string;
  items: IDailyChecklistItem[];
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const DailyChecklistItemSchema = new Schema<IDailyChecklistItem>(
  {
    templateId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: ["pre", "post"],
      required: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const DailyChecklistSchema = new Schema<IDailyChecklist>(
  {
    clerkId: {
      type: String,
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
    },
    items: {
      type: [DailyChecklistItemSchema],
      default: [],
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

DailyChecklistSchema.index({ clerkId: 1, date: 1 }, { unique: true });

export const DailyChecklist: Model<IDailyChecklist> =
  mongoose.models.DailyChecklist ||
  mongoose.model<IDailyChecklist>("DailyChecklist", DailyChecklistSchema);
