import { Router } from "express";
import { requireAuth } from "@clerk/express";
import {
  getRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
} from "../controllers/ruleController";

const router = Router();

router.use(requireAuth());

router.route("/").get(getRules).post(createRule);

router
  .route("/:id")
  .get(getRule)
  .patch(updateRule)
  .delete(deleteRule);

export default router;
