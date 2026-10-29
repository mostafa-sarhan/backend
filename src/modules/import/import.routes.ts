import { Router } from "express";
import { requireAuth, adminOnly } from "../auth/auth.middleware";
import { limits } from "../../lib/rateLimit";
import { xlsxUpload } from "./upload";
import * as c from "./import.controller";

// Excel order import (owner and admin). Low per-user limit; the limiter runs before the upload is read.
const router = Router();
router.use(requireAuth, adminOnly);

router.get("/template", c.template);
router.post("/", limits.import, xlsxUpload, c.importOrders);

export default router;
