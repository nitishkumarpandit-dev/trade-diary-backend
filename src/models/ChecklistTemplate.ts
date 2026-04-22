import mongoose, { Schema, Document } from 'mongoose';

export interface IChecklistTemplate extends Document {
  clerkId: string;
  title: string;
  category: string;
  type: 'pre' | 'post';
  order: number;
}

const ChecklistTemplateSchema: Schema = new Schema(
  {
    clerkId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    type: { type: String, enum: ['pre', 'post'], required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IChecklistTemplate>('ChecklistTemplate', ChecklistTemplateSchema);
