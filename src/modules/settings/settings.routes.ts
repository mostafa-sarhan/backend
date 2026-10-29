import { Router } from "express";
import { requireAuth, adminOnly, staffOnly } from "../auth/auth.middleware";
import * as c from "./settings.controller";

const router = Router();
router.use(requireAuth);

router.get("/", staffOnly, c.get);
router.put("/", adminOnly, c.update);

export default router;
