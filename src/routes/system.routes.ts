// src/routes/system.routes.ts

import { Router } from "express";
import * as systemController from "../controllers/system.controller";

const router = Router();

router.get("/outbound-ip", systemController.getOutboundIp);

export default router;
