import { Router } from "express";
import * as c from "./platform.controller";
import { limits } from "../../lib/rateLimit";

// Public "Request access" form (landing page, Phase E).
const router = Router();
router.post("/", limits.accessRequest, c.submitAccessRequest);

export default router;
