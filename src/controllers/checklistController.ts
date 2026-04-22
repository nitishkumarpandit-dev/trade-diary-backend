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

// ── GET /api/checklists/templates ──────────────────────────────────────────────

export const getTemplates = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);
    const templates = await ChecklistTemplate.find({ clerkId }).sort({ type: 1, order: 1 });

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

    // No saved entry — return empty list (frontend will show defaults)
    res.json({
      date,
      items: [],
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

// ── GET /api/checklists/analysis ───────────────────────────────────────────────

export const getChecklistAnalysis = async (req: Request, res: Response) => {
  try {
    const clerkId = getUserId(req);

    // 1. Fetch all daily entries for this user
    const dailyEntries = await DailyChecklist.find({ clerkId }).sort({ date: 1 });

    if (dailyEntries.length === 0) {
      return res.json({
        stats: { streak: 0, avgCompletion: 0, bestDay: 0, totalLogged: 0 },
        trend: { labels: [], data: [] },
        weekday: [0, 0, 0, 0, 0],
        insight: "Start your journey by checking off your first task today!",
      });
    }

    // 2. Calculate Stats
    let totalCompleted = 0;
    let totalItems = 0;
    let bestDayPercent = 0;
    const totalLogged = dailyEntries.length;

    dailyEntries.forEach((entry) => {
      const dayTotal = entry.items.length;
      const dayCompleted = entry.items.filter((i) => i.completed).length;
      const dayPercent = dayTotal > 0 ? (dayCompleted / dayTotal) * 100 : 0;

      totalCompleted += dayCompleted;
      totalItems += dayTotal;
      if (dayPercent > bestDayPercent) bestDayPercent = dayPercent;
    });

    const avgCompletion = totalItems > 0 ? (totalCompleted / totalItems) * 100 : 0;

    // 3. Current Streak
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Map dates for easy lookup
    const entryDates = new Set(dailyEntries.map((e) => e.date));

    // Check if user has an entry today or yesterday to continue streak
    let currentCheck = new Date(today);
    const todayStr = currentCheck.toISOString().split("T")[0];

    // If no entry today, check if streak holds from yesterday
    if (!entryDates.has(todayStr)) {
      currentCheck.setDate(currentCheck.getDate() - 1);
    }

    while (entryDates.has(currentCheck.toISOString().split("T")[0])) {
      streak++;
      currentCheck.setDate(currentCheck.getDate() - 1);
    }

    // 4. Trend (Last 14 Days)
    const trendLabels: string[] = [];
    const trendData: number[] = [];
    const now = new Date();

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dStr = d.toISOString().split("T")[0];

      const entry = dailyEntries.find((e) => e.date === dStr);
      const label = i === 0 ? "Today" : `${d.getDate()}/${d.getMonth() + 1}`;

      trendLabels.push(label);
      if (entry) {
        const dayTotal = entry.items.length;
        const dayCompleted = entry.items.filter((i) => i.completed).length;
        trendData.push(dayTotal > 0 ? Math.round((dayCompleted / dayTotal) * 100) : 0);
      } else {
        trendData.push(0);
      }
    }

    // 5. Weekday Performance (Average % for Mon-Fri)
    const weekdaySums = [0, 0, 0, 0, 0]; // Mon, Tue, Wed, Thu, Fri
    const weekdayCounts = [0, 0, 0, 0, 0];

    dailyEntries.forEach((entry) => {
      const date = new Date(entry.date);
      const dayIndex = date.getDay(); // 0 (Sun) to 6 (Sat)

      if (dayIndex >= 1 && dayIndex <= 5) {
        const arrIdx = dayIndex - 1;
        const dayTotal = entry.items.length;
        const dayCompleted = entry.items.filter((i) => i.completed).length;

        weekdaySums[arrIdx] += dayTotal > 0 ? (dayCompleted / dayTotal) * 100 : 0;
        weekdayCounts[arrIdx]++;
      }
    });

    const weekdayAverages = weekdaySums.map((sum, i) =>
      weekdayCounts[i] > 0 ? Math.round(sum / weekdayCounts[i]) : 0
    );

    // 6. Insight Message
    const bestWeekdayIdx = weekdayAverages.indexOf(Math.max(...weekdayAverages));
    const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const insight = streak > 5
      ? `Impressive ${streak}-day streak! You are most disciplined on ${weekdays[bestWeekdayIdx]}.`
      : `Complete your checklist today to build your streak! Your ${weekdays[bestWeekdayIdx]} performance is leading.`;

    res.json({
      stats: {
        streak,
        avgCompletion: Math.round(avgCompletion),
        bestDay: Math.round(bestDayPercent),
        totalLogged,
      },
      trend: {
        labels: trendLabels,
        data: trendData,
      },
      weekday: weekdayAverages,
      insight,
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
