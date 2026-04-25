import { Router } from "express";
import { getReportData } from "../controllers/reportController";
import { requireAuth } from "@clerk/express";

const router = Router();

router.get("/", requireAuth(), getReportData);

export default router;
