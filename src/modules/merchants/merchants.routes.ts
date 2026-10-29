import { Router } from "express";
import { requireAuth, adminOnly, staffOnly } from "../auth/auth.middleware";
import * as c from "./merchants.controller";
import { limits } from "../../lib/rateLimit";

const router = Router();

// Merchant API (API key, no user session)
router.post("/order", limits.merchantApi, c.apiKeyAuth, c.createOrder);

// Staff management
router.get("/options", requireAuth, staffOnly, c.options);
router.get("/", requireAuth, adminOnly, c.list);
router.post("/", requireAuth, adminOnly, c.create);
router.patch("/:id", requireAuth, adminOnly, c.rename);
router.post("/:id/api-key", requireAuth, adminOnly, c.rotateKey);
router.delete("/:id/api-key", requireAuth, adminOnly, c.revokeKey);

export default router;
