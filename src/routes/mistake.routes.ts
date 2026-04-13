import { Router } from "express";
import { requireAuth } from "@clerk/express";
import {
  getMistakes,
  getMistake,
  createMistake,
  updateMistake,
  deleteMistake,
} from "../controllers/mistakeController";

const router = Router();

router.use(requireAuth());

router.route("/").get(getMistakes).post(createMistake);

router
  .route("/:id")
  .get(getMistake)
  .patch(updateMistake)
  .delete(deleteMistake);

export default router;
