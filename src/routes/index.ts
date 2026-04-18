import { Router } from "express";
import strategyRoutes from "./strategy.routes";
import ruleRoutes from "./rule.routes";
import mistakeRoutes from "./mistake.routes";
import tradeRoutes from "./trade.routes";

import dashboardRoutes from "./dashboard.routes";

const router = Router();

router.use("/strategies", strategyRoutes);
router.use("/rules", ruleRoutes);
router.use("/mistakes", mistakeRoutes);
router.use("/trades", tradeRoutes);
router.use("/dashboard", dashboardRoutes);

export default router;
