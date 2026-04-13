import { Router } from "express";
import { requireAuth } from "@clerk/express";
import {
  getTrades,
  getTrade,
  createTrade,
  updateTrade,
  deleteTrade,
} from "../controllers/tradeController";

const router = Router();

router.use(requireAuth());

router.route("/").get(getTrades).post(createTrade);

router
  .route("/:id")
  .get(getTrade)
  .patch(updateTrade)
  .delete(deleteTrade);

export default router;
