import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { getInsights } from "../controllers/ai.controller";

const router = Router();

router.use(requireAuth());

router.post("/insights", getInsights);

export default router;
