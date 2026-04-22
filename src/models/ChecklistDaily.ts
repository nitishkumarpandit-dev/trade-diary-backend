import mongoose, { Schema, Document } from 'mongoose';

export interface IChecklistItem extends Document {
  templateId: mongoose.Types.ObjectId;
  completed: boolean;
}

export interface IChecklistDaily extends Document {
  clerkId: string;
  date: string; // YYYY-MM-DD
  items: IChecklistItem[];
  notes: string;
}

const ChecklistDailySchema: Schema = new Schema(
  {
    clerkId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    items: [
      {
        templateId: { type: Schema.Types.ObjectId, ref: 'ChecklistTemplate', required: true },
        completed: { type: Boolean, default: false },
      },
    ],
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

// Compound index to ensure one checklist per user per day
ChecklistDailySchema.index({ clerkId: 1, date: 1 }, { unique: true });

export default mongoose.model<IChecklistDaily>('ChecklistDaily', ChecklistDailySchema);
