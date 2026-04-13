import { Router } from "express";
import { requireAuth } from "@clerk/express";
import {
  getStrategies,
  getStrategy,
  createStrategy,
  updateStrategy,
  deleteStrategy,
} from "../controllers/strategyController";

const router = Router();

// Apply requireAuth middleware to protect all strategy routes
router.use(requireAuth());

router.route("/").get(getStrategies).post(createStrategy);

router
  .route("/:id")
  .get(getStrategy)
  .patch(updateStrategy)
  .delete(deleteStrategy);

export default router;
