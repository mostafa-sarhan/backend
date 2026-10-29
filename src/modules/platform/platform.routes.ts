import { Router } from "express";
import { requirePlatformAdmin, requirePlatformAdminAllowingPasswordChange } from "./platform.middleware";
import * as c from "./platform.controller";
import { limits } from "../../lib/rateLimit";

const router = Router();

// Platform auth (separate from tenant login)
router.post("/auth/login", limits.platformLogin, c.login);
router.post("/auth/refresh", limits.refresh, c.refresh);
router.post("/auth/logout", c.logout);
router.get("/auth/me", requirePlatformAdminAllowingPasswordChange, c.me);
router.post("/auth/change-password", requirePlatformAdminAllowingPasswordChange, limits.passwordChange, c.changePassword);

router.use(requirePlatformAdmin, c.auditReads);

router.get("/tenants", c.listTenants);
router.post("/tenants", c.createTenant);
router.patch("/tenants/:id", c.updateTenant);

router.get("/access-requests", c.listAccessRequests);
router.post("/access-requests/:id/approve", c.approve);
router.post("/access-requests/:id/reject", c.reject);

router.get("/audit-logs", c.auditLog);

export default router;
