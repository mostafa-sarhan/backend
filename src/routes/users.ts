import { Router, Request } from "express";
import { z } from "zod";
import { User, ROLES, Role, publicUser, UserDoc } from "../models/User";
import { AuditEvent, AUDIT_ENTITIES } from "../models/AuditEvent";
import { requireAuth, adminOnly } from "../middleware/auth";
import { AppError, forbidden, notFound } from "../lib/errors";
import { ok, created } from "../lib/respond";
import { str, idParams, pagination, objectId } from "../lib/validate";
import { scope } from "../lib/scope";
import { UNSCOPED } from "../lib/tenantPlugin";
import { assertStrongPassword, hashPassword } from "../lib/password";
import { revokeAllSessions } from "../lib/tokens";
import { recordAudit } from "../services/audit";
import { assertUserQuota } from "../services/tenants";

const router = Router();
router.use(requireAuth, adminOnly);

const role = z.enum(ROLES);

// Only owners can touch owner accounts or hand out the owner role.
function assertCanManage(req: Request, target: UserDoc | null, newRole?: Role) {
  if (req.user!.role === "owner") return;
  if (target?.role === "owner" || newRole === "owner") throw forbidden("Only an owner can manage owners");
}

async function findUser(req: Request) {
  const { id } = idParams.parse(req.params);
  const user = await User.findOne({ _id: id, ...scope(req) });
  if (!user) throw notFound("User");
  return user;
}

router.get("/", async (req, res) => {
  const users = await User.find(scope(req)).sort({ createdAt: 1 });
  ok(res, users.map((u) => ({ ...publicUser(u), createdAt: u.createdAt })));
});

router.post("/", async (req, res) => {
  const body = z.object({ email: str.email, password: z.string(), role }).parse(req.body);
  assertCanManage(req, null, body.role);
  assertStrongPassword(body.password, body.email);
  await assertUserQuota(req);

  // Emails are unique across the whole platform.
  if (await User.exists({ email: body.email }).setOptions(UNSCOPED)) {
    throw new AppError(409, "DUPLICATE", "This email is already registered");
  }

  const user = await User.create({ ...scope(req), email: body.email, password: await hashPassword(body.password), role: body.role });
  await recordAudit(req, { entity: "user", entityId: user._id, action: "CREATE_USER", label: user.email, changes: { role: { from: null, to: user.role } } });

  created(res, publicUser(user));
});

router.put("/:id/password", async (req, res) => {
  const user = await findUser(req);
  assertCanManage(req, user);
  const { newPassword } = z.object({ newPassword: z.string() }).parse(req.body);
  assertStrongPassword(newPassword, user.email);

  user.password = await hashPassword(newPassword);
  await user.save();
  await revokeAllSessions("tenant", user._id, user.tenantId);
  await recordAudit(req, { entity: "user", entityId: user._id, action: "CHANGE_PASSWORD", label: user.email });

  ok(res, publicUser(user));
});

router.put("/:id/role", async (req, res) => {
  const user = await findUser(req);
  const { role: newRole } = z.object({ role }).parse(req.body);
  assertCanManage(req, user, newRole);
  if (user.role === newRole) return ok(res, publicUser(user));

  // Never demote yourself, the last owner, or the last admin-level user.
  if (user._id.toString() === req.user!.id) throw new AppError(409, "LAST_ADMIN", "You can't change your own role");
  if (user.role === "owner" && (await User.countDocuments({ ...scope(req), role: "owner" })) <= 1) {
    throw new AppError(409, "LAST_OWNER", "At least one owner is required");
  }

  const oldRole = user.role;
  user.role = newRole;
  await user.save();
  await revokeAllSessions("tenant", user._id, user.tenantId);
  await recordAudit(req, { entity: "user", entityId: user._id, action: "CHANGE_ROLE", label: user.email, changes: { role: { from: oldRole, to: newRole } } });

  ok(res, publicUser(user));
});

// Audit log, newest first: ?page&limit&entity&entityId
router.get("/audit-logs", async (req, res) => {
  const q = pagination
    .extend({ entity: z.enum(AUDIT_ENTITIES).optional(), entityId: objectId.optional() })
    .parse(req.query);
  const filter = { ...scope(req), ...(q.entity && { entity: q.entity }), ...(q.entityId && { entityId: q.entityId }) };

  const [items, total] = await Promise.all([
    AuditEvent.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    AuditEvent.countDocuments(filter),
  ]);
  ok(res, items, { total, page: q.page, pages: Math.ceil(total / q.limit) });
});

export default router;
