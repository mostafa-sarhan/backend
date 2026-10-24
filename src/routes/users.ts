import { Router } from "express";
import { z } from "zod";
import { User, ROLES, publicUser } from "../models/User";
import { AuditEvent, AUDIT_ENTITIES } from "../models/AuditEvent";
import { requireAuth, adminOnly } from "../middleware/auth";
import { AppError, notFound } from "../lib/errors";
import { ok, created } from "../lib/respond";
import { str, idParams, pagination, objectId } from "../lib/validate";
import { assertStrongPassword, hashPassword } from "../lib/password";
import { revokeAllSessions } from "../lib/tokens";
import { recordAudit } from "../services/audit";

const router = Router();
router.use(requireAuth, adminOnly);

const role = z.enum(ROLES);

router.get("/", async (_req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  ok(res, users.map((u) => ({ ...publicUser(u), createdAt: u.createdAt })));
});

router.post("/", async (req, res) => {
  const body = z.object({ email: str.email, password: z.string(), role }).parse(req.body);
  assertStrongPassword(body.password, body.email);

  if (await User.exists({ email: body.email })) throw new AppError(409, "DUPLICATE", "User already exists");

  const user = await User.create({ email: body.email, password: await hashPassword(body.password), role: body.role });
  await recordAudit(req, { entity: "user", entityId: user._id, action: "CREATE_USER", label: user.email, changes: { role: { from: null, to: user.role } } });

  created(res, publicUser(user));
});

router.put("/:id/password", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { newPassword } = z.object({ newPassword: z.string() }).parse(req.body);

  const user = await User.findById(id);
  if (!user) throw notFound("User");
  assertStrongPassword(newPassword, user.email);

  user.password = await hashPassword(newPassword);
  await user.save();
  await revokeAllSessions(user._id);
  await recordAudit(req, { entity: "user", entityId: user._id, action: "CHANGE_PASSWORD", label: user.email });

  ok(res, publicUser(user));
});

router.put("/:id/role", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { role: newRole } = z.object({ role }).parse(req.body);

  const user = await User.findById(id);
  if (!user) throw notFound("User");
  if (user.role === newRole) return ok(res, publicUser(user));

  // Never leave the system without an admin, and don't let admins demote themselves.
  if (user.role === "admin") {
    if (user._id.toString() === req.user!.id) {
      throw new AppError(409, "LAST_ADMIN", "You can't remove your own admin role");
    }
    if ((await User.countDocuments({ role: "admin" })) <= 1) {
      throw new AppError(409, "LAST_ADMIN", "At least one admin is required");
    }
  }

  const oldRole = user.role;
  user.role = newRole;
  await user.save();
  await revokeAllSessions(user._id);
  await recordAudit(req, { entity: "user", entityId: user._id, action: "CHANGE_ROLE", label: user.email, changes: { role: { from: oldRole, to: newRole } } });

  ok(res, publicUser(user));
});

// Audit log, newest first: ?page&limit&entity&entityId
router.get("/audit-logs", async (req, res) => {
  const q = pagination
    .extend({ entity: z.enum(AUDIT_ENTITIES).optional(), entityId: objectId.optional() })
    .parse(req.query);
  const filter = { ...(q.entity && { entity: q.entity }), ...(q.entityId && { entityId: q.entityId }) };

  const [items, total] = await Promise.all([
    AuditEvent.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    AuditEvent.countDocuments(filter),
  ]);
  ok(res, items, { total, page: q.page, pages: Math.ceil(total / q.limit) });
});

export default router;
