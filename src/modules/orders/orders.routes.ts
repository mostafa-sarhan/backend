import { Router } from "express";
import { requireAuth, adminOnly, staffOnly } from "../auth/auth.middleware";
import * as c from "./orders.controller";
import { limits } from "../../lib/rateLimit";

const router = Router();
router.use(requireAuth, staffOnly);

router.get("/", c.list);
router.get("/export", adminOnly, limits.export, c.exportAll);
router.get("/stats", c.stats);
router.post("/bulk/assign", c.bulkAssign);
router.post("/bulk/status", c.bulkStatus);
router.get("/barcode/:barcode", c.byBarcode);
router.get("/:id", c.get);
router.get("/:id/history", c.history);
router.post("/", c.create);
router.patch("/:id", c.update);
router.delete("/:id", adminOnly, c.remove);

export default router;
