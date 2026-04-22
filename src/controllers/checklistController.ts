import { Request, Response } from 'express';
import ChecklistTemplate from '../models/ChecklistTemplate';
import ChecklistDaily from '../models/ChecklistDaily';

interface RequestWithAuth extends Request {
  auth?: {
    userId: string;
  };
}

const DEFAULT_PRE_MARKET = [
  { title: 'Check Global Indices', category: 'Market Analysis', type: 'pre', order: 0 },
  { title: 'Review Key News/Events', category: 'Market Analysis', type: 'pre', order: 1 },
  { title: 'Identify Support/Resistance', category: 'Technical Analysis', type: 'pre', order: 2 },
  { title: 'Define Risk per Trade', category: 'Risk Management', type: 'pre', order: 3 },
  { title: 'Set Alerts for Levels', category: 'Execution', type: 'pre', order: 4 },
] as const;

const DEFAULT_POST_MARKET = [
  { title: 'Log All Trades', category: 'Journaling', type: 'post', order: 0 },
  { title: 'Review Mistakes/Wins', category: 'Self Reflection', type: 'post', order: 1 },
  { title: 'Update P&L Sheet', category: 'Accounting', type: 'post', order: 2 },
  { title: 'Analyze Emotional State', category: 'Psychology', type: 'post', order: 3 },
  { title: 'Prepare for Next Day', category: 'Planning', type: 'post', order: 4 },
] as const;

export const getDailyChecklist = async (req: RequestWithAuth, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { date } = req.query;

    if (!clerkId || !date) {
      return res.status(400).json({ message: 'ClerkId and Date are required' });
    }

    // 1. Get/Seed Templates
    let templates = await ChecklistTemplate.find({ clerkId }).sort({ order: 1 });

    if (templates.length === 0) {
      const seeded = [
        ...DEFAULT_PRE_MARKET.map(i => ({ ...i, clerkId })),
        ...DEFAULT_POST_MARKET.map(i => ({ ...i, clerkId }))
      ];
      templates = await ChecklistTemplate.insertMany(seeded) as any;
    }

    // 2. Get Daily State
    const daily = await ChecklistDaily.findOne({ clerkId, date });

    // 3. Merge template data with daily completion state
    const items = templates.map(t => {
      const dailyItem = daily?.items.find(di => di.templateId.toString() === t._id.toString());
      return {
        templateId: t._id,
        title: t.title,
        category: t.category,
        type: t.type,
        completed: dailyItem ? dailyItem.completed : false
      };
    });

    res.json({
      date,
      items,
      notes: daily?.notes || ''
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const saveDailyChecklist = async (req: RequestWithAuth, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { date, templates: updatedTemplates, items, notes } = req.body;

    if (!clerkId || !date) {
      return res.status(400).json({ message: 'ClerkId and Date are required' });
    }

    // 1. Sync Templates
    const existingTemplates = await ChecklistTemplate.find({ clerkId });
    const existingIds = existingTemplates.map(t => t._id.toString());
    const updatedIds = updatedTemplates.filter((t: any) => t.id).map((t: any) => t.id);

    // Delete removed templates
    const toDelete = existingIds.filter(id => !updatedIds.includes(id));
    if (toDelete.length > 0) {
      await ChecklistTemplate.deleteMany({ _id: { $in: toDelete }, clerkId });
    }

    // Process templates sequentially or in parallel but we need the final set
    for (let i = 0; i < updatedTemplates.length; i++) {
      const t = updatedTemplates[i];
      if (t.id) {
        await ChecklistTemplate.updateOne(
          { _id: t.id, clerkId },
          { title: t.title, category: t.category, type: t.type, order: i }
        );
      } else {
        await ChecklistTemplate.create({
          clerkId,
          title: t.title,
          category: t.category,
          type: t.type,
          order: i
        });
      }
    }
    
    const finalTemplates = await ChecklistTemplate.find({ clerkId }).sort({ order: 1 });

    // 2. Update Daily State
    const mappedItems = items.map((item: any) => {
      let tid = item.templateId;
      // If it's a temp ID, find the real ID from finalTemplates by matching title/type
      if (tid.startsWith('temp-')) {
        const found = finalTemplates.find(t => t.title === item.title && t.type === item.type);
        tid = found ? found._id : tid;
      }
      return {
        templateId: tid,
        completed: item.completed
      };
    });

    const daily = await ChecklistDaily.findOneAndUpdate(
      { clerkId, date },
      { items: mappedItems, notes },
      { upsert: true, new: true }
    );

    res.json({ message: 'Checklist updated successfully', daily });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getTemplates = async (req: RequestWithAuth, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) return res.status(401).json({ message: 'Unauthorized' });

    const templates = await ChecklistTemplate.find({ clerkId }).sort({ order: 1 });
    res.json({ data: templates });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getChecklistAnalysis = async (req: RequestWithAuth, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) return res.status(401).json({ message: 'Unauthorized' });

    // TODO: Implement actual aggregate analytics
    res.json({
      stats: { streak: 0, avgCompletion: 0, bestDay: 0, totalLogged: 0 },
      trend: { labels: [], data: [] },
      weekday: [],
      insight: 'Analysis is being calculated. Check back after logging more days.'
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
