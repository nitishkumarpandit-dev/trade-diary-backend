import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { getDashboardData } from "../controllers/dashboardController";

const router = Router();

// GET /api/dashboard
router.get("/", requireAuth(), getDashboardData);

export default router;
