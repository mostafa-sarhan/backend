import { Router } from "express";
import { requireAuthAllowingPasswordChange } from "./auth.middleware";
import * as c from "./auth.controller";
import { limits } from "../../lib/rateLimit";

const router = Router();

router.post("/login", limits.login, c.login);
router.post("/refresh", limits.refresh, c.refresh);
router.post("/logout", c.logout);
router.get("/me", requireAuthAllowingPasswordChange, c.me);
router.post("/change-password", requireAuthAllowingPasswordChange, limits.passwordChange, c.changePassword);

export default router;
