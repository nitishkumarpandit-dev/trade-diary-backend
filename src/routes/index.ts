import { Router } from "express";
import strategyRoutes from "./strategy.routes";
import ruleRoutes from "./rule.routes";
import mistakeRoutes from "./mistake.routes";
import tradeRoutes from "./trade.routes";

const router = Router();

router.use("/strategies", strategyRoutes);
router.use("/rules", ruleRoutes);
router.use("/mistakes", mistakeRoutes);
router.use("/trades", tradeRoutes);

export default router;
