import { Request, Response } from "express";
import { loginGuard } from "../../lib/rateLimit";
import { User, UserDoc, publicUser } from "../users/user.model";
import { TenantDoc } from "../tenants/tenant.model";
import { loadUsableTenant } from "../tenants/tenants.service";
import { recordAudit } from "../audit/audit.service";
import { AppError } from "../../lib/errors";
import { UNSCOPED } from "../../lib/tenantPlugin";
import { withTransaction } from "../../lib/transaction";
import { verifyPassword, needsRehash, hashPassword, assertStrongPassword } from "./password";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllSessions, setSessionCookies, clearSessionCookies } from "./tokens";

export const publicTenant = (t: TenantDoc) => ({
  id: t._id.toString(),
  name: t.name,
  slug: t.slug,
  plan: t.plan,
  status: t.status,
  trialEndsAt: t.trialEndsAt,
  currency: t.settings?.currency,
  timezone: t.settings?.timezone,
});

const invalidCredentials = () => new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
const guard = loginGuard("tenant");

async function startSession(res: Response, user: UserDoc) {
  const { token } = await issueRefreshToken("tenant", user);
  setSessionCookies(res, "tenant", signAccessToken("tenant", user), token);
}

// Emails are globally unique, so the tenant is found from the user (cross-tenant lookup by design).
export async function login(req: Request, res: Response, email: string, password: string) {
  await guard.assertNotLocked(req, email);
  const user = await User.findOne({ email }).setOptions(UNSCOPED);
  // Same response for unknown email and wrong password, so emails can't be probed.
  if (!user || !(await verifyPassword(password, user.password))) {
    await guard.recordFailure(email);
    throw invalidCredentials();
  }
  await guard.recordSuccess(email);
  const tenant = await loadUsableTenant(user.tenantId);

  if (needsRehash(user.password)) {
    user.password = await hashPassword(password);
    await user.save();
  }
  await startSession(res, user);
  return { user: publicUser(user), tenant: publicTenant(tenant) };
}

export async function refresh(res: Response, token: string | undefined) {
  try {
    const { subject, refreshToken } = await rotateRefreshToken("tenant", token);
    const user = subject as UserDoc;
    const tenant = await loadUsableTenant(user.tenantId);
    setSessionCookies(res, "tenant", signAccessToken("tenant", user), refreshToken);
    return { user: publicUser(user), tenant: publicTenant(tenant) };
  } catch (err) {
    clearSessionCookies(res, "tenant");
    throw err;
  }
}

export async function logout(res: Response, token: string | undefined) {
  await revokeRefreshToken(token);
  clearSessionCookies(res, "tenant");
}

// Other sessions are logged out; this one continues with fresh tokens. Clears mustChangePassword.
export async function changeOwnPassword(req: Request, res: Response, currentPassword: string, newPassword: string) {
  const user = await User.findOne({ _id: req.user!.id, tenantId: req.tenant!._id });
  if (!user) throw invalidCredentials();
  await guard.assertNotLocked(req, user.email);
  if (!(await verifyPassword(currentPassword, user.password))) {
    await guard.recordFailure(user.email);
    throw new AppError(401, "INVALID_CREDENTIALS", "Current password is wrong");
  }
  if (await verifyPassword(newPassword, user.password)) throw new AppError(400, "WEAK_PASSWORD", "Choose a different password", ["Must differ from the current password"]);
  assertStrongPassword(newPassword, user.email);

  const hash = await hashPassword(newPassword);
  await withTransaction(async () => {
    await User.updateOne({ _id: user._id, tenantId: user.tenantId }, { $set: { password: hash, mustChangePassword: false } });
    await revokeAllSessions("tenant", user._id, user.tenantId);
    await recordAudit(req, { entity: "user", entityId: user._id, action: "CHANGE_OWN_PASSWORD", label: user.email });
  });

  const fresh = (await User.findOne({ _id: user._id, tenantId: user.tenantId }))!;
  await startSession(res, fresh);
  return { user: publicUser(fresh) };
}
