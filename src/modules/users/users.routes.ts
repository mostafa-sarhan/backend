import { Router } from "express";
import { requireAuth, adminOnly } from "../auth/auth.middleware";
import * as c from "./users.controller";

const router = Router();
router.use(requireAuth, adminOnly);

router.get("/", c.list);
router.post("/", c.create);
router.put("/:id/password", c.setPassword);
router.put("/:id/role", c.setRole);
router.get("/audit-logs", c.auditLogs);

export default router;
