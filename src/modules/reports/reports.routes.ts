import { Router } from "express";
import { requireAuth, adminOnly, staffOnly } from "../auth/auth.middleware";
import * as c from "./reports.controller";

const router = Router();
router.use(requireAuth, staffOnly);

router.get("/summary", adminOnly, c.summary);
router.get("/merchants", adminOnly, c.byField("merchant"));
router.get("/couriers", adminOnly, c.byField("courier"));
// A courier's current batch (Couriers page). Open to employees, configured fees only.
router.post("/settlement", c.settlement);

export default router;
