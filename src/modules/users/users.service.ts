import { Request } from "express";
import { z } from "zod";
import { User, Role, UserDoc, publicUser } from "./user.model";
import { AuditEvent } from "../audit/auditEvent.model";
import { recordAudit } from "../audit/audit.service";
import { assertUserQuota } from "../tenants/tenants.service";
import { assertStrongPassword, hashPassword } from "../auth/password";
import { revokeAllSessions } from "../auth/tokens";
import { AppError, forbidden, notFound } from "../../lib/errors";
import { scope } from "../../lib/scope";
import { UNSCOPED } from "../../lib/tenantPlugin";
import { withTransaction } from "../../lib/transaction";
import { createUserBody, auditLogQuery } from "./users.schemas";

// Only owners can touch owner accounts or hand out the owner role.
function assertCanManage(req: Request, target: UserDoc | null, newRole?: Role) {
  if (req.user!.role === "owner") return;
  if (target?.role === "owner" || newRole === "owner") throw forbidden("Only an owner can manage owners");
}

async function findUser(req: Request, id: string) {
  const user = await User.findOne({ _id: id, ...scope(req) });
  if (!user) throw notFound("User");
  return user;
}

export async function assertEmailFree(email: string) {
  // Emails are unique across the whole platform.
  if (await User.exists({ email }).setOptions(UNSCOPED)) throw new AppError(409, "DUPLICATE", "This email is already registered");
}

export async function listUsers(req: Request) {
  const users = await User.find(scope(req)).sort({ createdAt: 1 });
  return users.map((u) => ({ ...publicUser(u), createdAt: u.createdAt }));
}

// The password set by an admin is a one-time password: the user must change it on first login.
export async function createUser(
  req: Request,
  input: Omit<z.infer<typeof createUserBody>, "role"> & { role: Role },
  links: { courierId?: string; merchantId?: string } = {}
) {
  assertCanManage(req, null, input.role);
  assertStrongPassword(input.password, input.email);
  await assertUserQuota(req);
  await assertEmailFree(input.email);
  const password = await hashPassword(input.password);

  return withTransaction(async () => {
    const [user] = await User.create([{ ...scope(req), email: input.email, password, role: input.role, mustChangePassword: true, ...links }]);
    await recordAudit(req, { entity: "user", entityId: user._id, action: "CREATE_USER", label: user.email, changes: { role: { from: null, to: user.role } } });
    return publicUser(user);
  });
}

export async function setPassword(req: Request, id: string, newPassword: string) {
  const user = await findUser(req, id);
  assertCanManage(req, user);
  assertStrongPassword(newPassword, user.email);
  const hash = await hashPassword(newPassword);

  return withTransaction(async () => {
    await User.updateOne({ _id: user._id, ...scope(req) }, { $set: { password: hash, mustChangePassword: true } });
    await revokeAllSessions("tenant", user._id, user.tenantId);
    await recordAudit(req, { entity: "user", entityId: user._id, action: "CHANGE_PASSWORD", label: user.email });
    return publicUser(user);
  });
}

export async function setRole(req: Request, id: string, newRole: Role) {
  const user = await findUser(req, id);
  assertCanManage(req, user, newRole);
  if (user.role === newRole) return publicUser(user);
  if (["courier", "merchant"].includes(user.role)) {
    throw new AppError(400, "VALIDATION_ERROR", "Courier and merchant accounts are created from their own pages");
  }

  // Never change your own role or demote the last owner.
  if (user._id.toString() === req.user!.id) throw new AppError(409, "LAST_ADMIN", "You can't change your own role");
  if (user.role === "owner" && (await User.countDocuments({ ...scope(req), role: "owner" })) <= 1) {
    throw new AppError(409, "LAST_OWNER", "At least one owner is required");
  }

  const oldRole = user.role;
  return withTransaction(async () => {
    await User.updateOne({ _id: user._id, ...scope(req) }, { $set: { role: newRole } });
    await revokeAllSessions("tenant", user._id, user.tenantId);
    await recordAudit(req, { entity: "user", entityId: user._id, action: "CHANGE_ROLE", label: user.email, changes: { role: { from: oldRole, to: newRole } } });
    return { ...publicUser(user), role: newRole };
  });
}

export async function listAuditLogs(req: Request, q: z.infer<typeof auditLogQuery>) {
  const filter = { ...scope(req), ...(q.entity && { entity: q.entity }), ...(q.entityId && { entityId: q.entityId }) };
  const [items, total] = await Promise.all([
    AuditEvent.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    AuditEvent.countDocuments(filter),
  ]);
  return { items, meta: { total, page: q.page, pages: Math.ceil(total / q.limit) } };
}
