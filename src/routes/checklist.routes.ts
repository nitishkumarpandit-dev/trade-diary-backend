import { Router } from "express";
import { requireAuth } from "@clerk/express";
import {
  getTemplates,
  getDailyChecklist,
  saveDailyChecklist,
  getChecklistAnalysis,
} from "../controllers/checklistController";

const router = Router();

router.use(requireAuth());

// Analysis endpoint
router.route("/analysis").get(getChecklistAnalysis);

// Template endpoints
router.route("/templates").get(getTemplates);

// Daily entry endpoints
router.route("/daily").get(getDailyChecklist).put(saveDailyChecklist);

export default router;
