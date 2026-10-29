import { Router } from "express";
import { requireAuth, staffOnly } from "../auth/auth.middleware";
import { limits } from "../../lib/rateLimit";
import { xlsxUpload } from "./upload";
import * as c from "./import.controller";

// Excel order import (staff). Low per-user limit; the limiter runs before the upload is read.
const router = Router();
router.use(requireAuth, staffOnly);

router.get("/template", c.template);
router.post("/", limits.import, xlsxUpload, c.importOrders);

export default router;
