import { Router } from "express";
import * as brokerController from "../controllers/brokerController";

const router = Router();

// POST /api/broker/connect/delta
router.post("/connect/delta", brokerController.connectDelta);

// GET /api/broker/status
router.get("/status", brokerController.getBrokerStatus);

// POST /api/broker/disconnect
router.post("/disconnect", brokerController.disconnectBroker);

// POST /api/broker/sync-trades
router.post("/sync-trades", brokerController.syncTrades);

export default router;
