import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { User, publicUser, UserDoc } from "../models/User";
import { TenantDoc } from "../models/Tenant";
import { AppError } from "../lib/errors";
import { ok } from "../lib/respond";
import { str } from "../lib/validate";
import { UNSCOPED } from "../lib/tenantPlugin";
import { verifyPassword, needsRehash, hashPassword, assertStrongPassword } from "../lib/password";
import {
  cookieNames,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllSessions,
  setSessionCookies,
  clearSessionCookies,
} from "../lib/tokens";
import { requireAuth } from "../middleware/auth";
import { loadUsableTenant } from "../services/tenants";
import { recordAudit } from "../services/audit";

const router = Router();
const REFRESH = cookieNames("tenant").refresh;

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many login attempts, try again later")),
});

export const loginBody = z.object({ email: str.email, password: z.string().min(1).max(200) });

const publicTenant = (t: TenantDoc) => ({
  id: t._id.toString(),
  name: t.name,
  slug: t.slug,
  plan: t.plan,
  status: t.status,
  trialEndsAt: t.trialEndsAt,
  currency: t.settings?.currency,
});

async function startSession(res: Response, user: UserDoc) {
  const { token } = await issueRefreshToken("tenant", user);
  setSessionCookies(res, "tenant", signAccessToken("tenant", user), token);
}

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = loginBody.parse(req.body);

  // Emails are globally unique, so the tenant is found from the user (cross-tenant lookup by design).
  const user = await User.findOne({ email }).setOptions(UNSCOPED);
  // Same response for unknown email and wrong password, so emails can't be probed.
  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  const tenant = await loadUsableTenant(user.tenantId);

  if (needsRehash(user.password)) {
    user.password = await hashPassword(password);
    await user.save();
  }

  await startSession(res, user);
  ok(res, { user: publicUser(user), tenant: publicTenant(tenant) });
});

router.post("/refresh", async (req, res) => {
  try {
    const { subject, refreshToken } = await rotateRefreshToken("tenant", req.cookies?.[REFRESH]);
    const user = subject as UserDoc;
    const tenant = await loadUsableTenant(user.tenantId);
    setSessionCookies(res, "tenant", signAccessToken("tenant", user), refreshToken);
    ok(res, { user: publicUser(user), tenant: publicTenant(tenant) });
  } catch (err) {
    clearSessionCookies(res, "tenant");
    throw err;
  }
});

router.post("/logout", async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH]);
  clearSessionCookies(res, "tenant");
  ok(res, { loggedOut: true });
});

router.get("/me", requireAuth, (req: Request, res) => {
  ok(res, { user: req.user, tenant: publicTenant(req.tenant!) });
});

// Any user can change their own password. Other sessions are logged out; this one continues.
router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string() }).parse(req.body);
  const user = await User.findOne({ _id: req.user!.id, tenantId: req.tenant!._id });
  if (!user || !(await verifyPassword(currentPassword, user.password))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Current password is wrong");
  }
  assertStrongPassword(newPassword, user.email);

  user.password = await hashPassword(newPassword);
  await user.save();
  await revokeAllSessions("tenant", user._id, user.tenantId);
  await recordAudit(req, { entity: "user", entityId: user._id, action: "CHANGE_OWN_PASSWORD", label: user.email });

  const fresh = await User.findOne({ _id: user._id, tenantId: user.tenantId });
  await startSession(res, fresh!);
  ok(res, { user: publicUser(fresh!) });
});

export default router;
