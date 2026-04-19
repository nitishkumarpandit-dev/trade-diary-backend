import { Request, Response } from "express";
import { ChecklistTemplate, IChecklistTemplate } from "../models/ChecklistTemplate";
import { DailyChecklist } from "../models/DailyChecklist";

// ── Helpers ────────────────────────────────────────────────────────────────────

const getUserId = (req: any): string => {
  if (!req.auth || !req.auth.userId) {
    throw new Error("Unauthorized");
  }
  return req.auth.userId;
};

/** Returns today's date string in YYYY-MM-DD format (UTC). */
const getTodayStr = (): string => {
  return new Date().toISOString().split("T")[0];
};

// ── Default seed items for new users ───────────────────────────────────────────

const DEFAULT_PRE_MARKET = [
  { title: "Check Global Indices", category: "Market Analysis", type: "pre" as const, order: 0 },
  { title: "Review Key Levels (S/R)", category: "Technical Analysis", type: "pre" as const, order: 1 },
  { title: "Analyze FII/DII Data", category: "Market Analysis", type: "pre" as const, order: 2 },
  { title: "Check Economic Calendar", category: "Fundamental", type: "pre" as const, order: 3 },
  { title: "Define Daily Bias", category: "Strategy", type: "pre" as const, order: 4 },
];

const DEFAULT_POST_MARKET = [
  { title: "Journal All Trades", category: "Review", type: "post" as const, order: 0 },
  { title: "Upload Trade Charts", category: "Review", type: "post" as const, order: 1 },
  { title: "Review Rule Adherence", category: "Discipline", type: "post" as const, order: 2 },
  { title: "Calculate Daily P&L", category: "Review", type: "post" as const, order: 3 },
  { title: "Plan Tomorrow's Watchlist", category: "Preparation", type: "post" as const, order: 4 },
];

/** Seeds default templates if user has none. Returns all templates. */
const ensureTemplates = async (clerkId: string): Promise<IChecklistTemplate[]> => {
  const existing = await ChecklistTemplate.find({ clerkId }).sort({ type: 1, order: 1 });

  if (existing.length > 0) {
    return existing;
  }

  // Seed defaults
  const defaults = [...DEFAULT_PRE_MARKET, ...DEFAULT_POST_MARKET].map((item) => ({
    ...item,
    clerkId,
  }));

  const seeded = await ChecklistTemplate.insertMany(defaults);
  return seeded as IChecklistTemplate[];
};

// ── GET /api/checklists/templates ──────────────────────────────────────────────

export const getTemplates = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const templates = await ensureTemplates(clerkId);

    const formatted = templates.map((t) => {
      const obj = t.toObject ? t.toObject() : t;
      return { ...obj, id: obj._id.toString() };
    });

    res.json({ data: formatted });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ── GET /api/checklists/daily?date=YYYY-MM-DD ──────────────────────────────────

export const getDailyChecklist = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const date = (req.query.date as string) || getTodayStr();

    // Check for an existing daily entry
    const dailyEntry = await DailyChecklist.findOne({ clerkId, date });

    if (dailyEntry) {
      return res.json({
        date: dailyEntry.date,
        items: dailyEntry.items,
        notes: dailyEntry.notes,
        isSaved: true,
      });
    }

    // No saved entry — return templates with completed: false
    const templates = await ensureTemplates(clerkId);

    const items = templates.map((t) => ({
      templateId: t._id.toString(),
      title: t.title,
      category: t.category,
      type: t.type,
      completed: false,
    }));

    res.json({
      date,
      items,
      notes: "",
      isSaved: false,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ── PUT /api/checklists/daily ──────────────────────────────────────────────────
// Saves templates + daily entry in one batch. Only allowed for today.

export const saveDailyChecklist = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const { date, templates, items, notes } = req.body;

    // Server-side today check
    const today = getTodayStr();
    if (date !== today) {
      return res.status(403).json({
        error: "You can only save the checklist for today.",
      });
    }

    // ── Sync templates ─────────────────────────────────────────────────────────
    if (templates && Array.isArray(templates)) {
      // Get current template IDs
      const currentTemplates = await ChecklistTemplate.find({ clerkId });
      const currentIds = new Set(currentTemplates.map((t) => t._id.toString()));

      // IDs sent from frontend (existing items)
      const sentIds = new Set(
        templates.filter((t: any) => t.id).map((t: any) => t.id)
      );

      // Delete templates that are no longer in the list
      const toDelete = [...currentIds].filter((id) => !sentIds.has(id));
      if (toDelete.length > 0) {
        await ChecklistTemplate.deleteMany({ _id: { $in: toDelete }, clerkId });
      }

      // Upsert templates
      for (const tmpl of templates) {
        if (tmpl.id) {
          // Update existing
          await ChecklistTemplate.findOneAndUpdate(
            { _id: tmpl.id, clerkId },
            { title: tmpl.title, category: tmpl.category, type: tmpl.type, order: tmpl.order },
            { runValidators: true }
          );
        } else {
          // Create new
          await ChecklistTemplate.create({
            clerkId,
            title: tmpl.title,
            category: tmpl.category,
            type: tmpl.type,
            order: tmpl.order ?? 0,
          });
        }
      }
    }

    // ── Upsert daily entry ─────────────────────────────────────────────────────
    const dailyEntry = await DailyChecklist.findOneAndUpdate(
      { clerkId, date },
      {
        items: items || [],
        notes: notes || "",
      },
      { upsert: true, new: true, runValidators: true }
    );

    // Return updated templates + daily entry
    const updatedTemplates = await ChecklistTemplate.find({ clerkId }).sort({ type: 1, order: 1 });
    const formattedTemplates = updatedTemplates.map((t) => {
      const obj = t.toObject ? t.toObject() : t;
      return { ...obj, id: obj._id.toString() };
    });

    res.json({
      templates: formattedTemplates,
      daily: {
        date: dailyEntry.date,
        items: dailyEntry.items,
        notes: dailyEntry.notes,
        isSaved: true,
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};
