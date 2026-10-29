import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware";
import * as c from "./courierApp.controller";

// Courier mobile view API (role courier only).
const router = Router();
router.use(requireAuth, requireRole("courier"));

router.get("/orders", c.orders);
router.get("/today", c.today);
router.post("/orders/:id/outcome", c.outcome);

export default router;
