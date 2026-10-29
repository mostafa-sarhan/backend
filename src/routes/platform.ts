import { Router, Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { PlatformAdmin } from "../models/PlatformAdmin";
import { PlatformAuditEvent } from "../models/PlatformAuditEvent";
import { Tenant, PLANS, TENANT_STATUSES, TenantDoc } from "../models/Tenant";
import { AccessRequest, ACCESS_REQUEST_STATUSES } from "../models/AccessRequest";
import { AppError, notFound } from "../lib/errors";
import { ok, created } from "../lib/respond";
import { idParams, pagination, str } from "../lib/validate";
import { verifyPassword, needsRehash, hashPassword } from "../lib/password";
import {
  cookieNames,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeTenantSessions,
  setSessionCookies,
  clearSessionCookies,
} from "../lib/tokens";
import { requirePlatformAdmin } from "../middleware/platformAuth";
import { recordPlatformAudit } from "../services/platformAudit";
import { createTenantWithOwner, planDefaults } from "../services/platform";
import { diff } from "../services/audit";
import { loginLimiter, loginBody } from "./auth";

const router = Router();
const REFRESH = cookieNames("platform").refresh;

// ---------------- Platform auth (separate from tenant login) ----------------
router.post("/auth/login", loginLimiter, async (req, res) => {
  const { email, password } = loginBody.parse(req.body);
  const admin = await PlatformAdmin.findOne({ email });
  if (!admin || !(await verifyPassword(password, admin.password))) {
    await recordPlatformAudit(req, { action: "LOGIN_FAILED", target: { type: "platform_admin", label: email } });
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (needsRehash(admin.password)) {
    admin.password = await hashPassword(password);
    await admin.save();
  }
  const { token } = await issueRefreshToken("platform", admin);
  setSessionCookies(res, "platform", signAccessToken("platform", admin), token);
  req.platformAdmin = { id: admin._id.toString(), email: admin.email };
  await recordPlatformAudit(req, { action: "LOGIN" });
  ok(res, { admin: req.platformAdmin });
});

router.post("/auth/refresh", async (req, res) => {
  try {
    const { subject, refreshToken } = await rotateRefreshToken("platform", req.cookies?.[REFRESH]);
    setSessionCookies(res, "platform", signAccessToken("platform", subject), refreshToken);
    ok(res, { admin: { id: subject._id.toString(), email: (subject as { email: string }).email } });
  } catch (err) {
    clearSessionCookies(res, "platform");
    throw err;
  }
});

router.post("/auth/logout", async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH]);
  clearSessionCookies(res, "platform");
  ok(res, { loggedOut: true });
});

router.use(requirePlatformAdmin);

// Reads are audited too: platform admins can see every tenant's account data.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "GET") {
    res.on("finish", () => {
      if (res.statusCode < 400) void recordPlatformAudit(req, { action: "VIEW", target: { type: "route", label: req.originalUrl.slice(0, 200) } });
    });
  }
  next();
});

router.get("/auth/me", (req, res) => {
  ok(res, { admin: req.platformAdmin });
});

// ---------------- Tenants ----------------
const tenantSummary = (t: TenantDoc) => ({
  _id: t._id,
  name: t.name,
  slug: t.slug,
  plan: t.plan,
  status: t.status,
  trialEndsAt: t.trialEndsAt,
  limits: t.limits,
  createdAt: t.createdAt,
});

router.get("/tenants", async (req, res) => {
  const q = pagination.extend({ status: z.enum(TENANT_STATUSES).optional() }).parse(req.query);
  const filter = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    Tenant.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    Tenant.countDocuments(filter),
  ]);
  ok(res, items.map(tenantSummary), { total, page: q.page, pages: Math.ceil(total / q.limit) });
});

const createTenantBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/).optional(),
    plan: z.enum(PLANS).default("trial"),
    ownerEmail: str.email,
  })
  .strict();

// Returns the owner's initial password once.
router.post("/tenants", async (req, res) => {
  const { tenant, owner, initialPassword } = await createTenantWithOwner(createTenantBody.parse(req.body));
  await recordPlatformAudit(req, { action: "CREATE_TENANT", target: { type: "tenant", id: tenant._id, label: tenant.name }, changes: { owner: { from: null, to: owner.email } } });
  created(res, { tenant: tenantSummary(tenant), owner: { email: owner.email }, initialPassword });
});

const limit = z.number().int().min(1).nullable();
const updateTenantBody = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    plan: z.enum(PLANS).optional(),
    status: z.enum(TENANT_STATUSES).optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    limits: z.object({ maxUsers: limit.optional(), maxOrdersPerMonth: limit.optional() }).strict().optional(),
  })
  .strict();

router.patch("/tenants/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = updateTenantBody.parse(req.body);
  const tenant = await Tenant.findById(id);
  if (!tenant) throw notFound("Tenant");

  const before = { name: tenant.name, plan: tenant.plan, status: tenant.status, trialEndsAt: tenant.trialEndsAt, ...tenant.limits };
  // A plan change brings that plan's limits unless limits are given explicitly.
  if (body.plan && body.plan !== tenant.plan) {
    const d = planDefaults(body.plan);
    tenant.plan = d.plan;
    tenant.limits = d.limits;
  }
  if (body.name) tenant.name = body.name;
  if (body.status) tenant.status = body.status;
  if (body.trialEndsAt !== undefined) tenant.trialEndsAt = body.trialEndsAt;
  if (body.limits) tenant.limits = { ...tenant.limits, ...body.limits };
  await tenant.save();

  if (body.status === "suspended" && before.status !== "suspended") await revokeTenantSessions(tenant._id);

  const after = { name: tenant.name, plan: tenant.plan, status: tenant.status, trialEndsAt: tenant.trialEndsAt, ...tenant.limits };
  await recordPlatformAudit(req, { action: "UPDATE_TENANT", target: { type: "tenant", id: tenant._id, label: tenant.name }, changes: diff(before, after) });
  ok(res, tenantSummary(tenant));
});

// ---------------- Access requests ----------------
router.get("/access-requests", async (req, res) => {
  const q = pagination.extend({ status: z.enum(ACCESS_REQUEST_STATUSES).optional() }).parse(req.query);
  const filter = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    AccessRequest.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    AccessRequest.countDocuments(filter),
  ]);
  ok(res, items, { total, page: q.page, pages: Math.ceil(total / q.limit) });
});

async function pendingRequest(req: Request) {
  const { id } = idParams.parse(req.params);
  const request = await AccessRequest.findById(id);
  if (!request) throw notFound("Access request");
  if (request.status !== "pending") throw new AppError(409, "CONFLICT", "This request was already reviewed");
  return request;
}

// Creates the tenant and its owner (the requester's email); returns the initial password once.
router.post("/access-requests/:id/approve", async (req, res) => {
  const body = z.object({ plan: z.enum(PLANS).default("trial"), slug: createTenantBody.shape.slug }).strict().parse(req.body ?? {});
  const request = await pendingRequest(req);

  const { tenant, owner, initialPassword } = await createTenantWithOwner({ name: request.companyName, slug: body.slug, plan: body.plan, ownerEmail: request.email });
  request.status = "approved";
  request.tenantId = tenant._id;
  request.reviewedBy = { id: new mongoose.Types.ObjectId(req.platformAdmin!.id), email: req.platformAdmin!.email };
  request.reviewedAt = new Date();
  await request.save();

  await recordPlatformAudit(req, { action: "APPROVE_ACCESS_REQUEST", target: { type: "access_request", id: request._id, label: request.companyName }, changes: { tenant: { from: null, to: tenant._id.toString() } } });
  created(res, { tenant: tenantSummary(tenant), owner: { email: owner.email }, initialPassword });
});

router.post("/access-requests/:id/reject", async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).strict().parse(req.body ?? {});
  const request = await pendingRequest(req);
  request.status = "rejected";
  request.rejectReason = reason;
  request.reviewedBy = { id: new mongoose.Types.ObjectId(req.platformAdmin!.id), email: req.platformAdmin!.email };
  request.reviewedAt = new Date();
  await request.save();
  await recordPlatformAudit(req, { action: "REJECT_ACCESS_REQUEST", target: { type: "access_request", id: request._id, label: request.companyName } });
  ok(res, request);
});

// ---------------- Platform audit log ----------------
router.get("/audit-logs", async (req, res) => {
  const q = pagination.parse(req.query);
  const [items, total] = await Promise.all([
    PlatformAuditEvent.find().sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    PlatformAuditEvent.countDocuments(),
  ]);
  ok(res, items, { total, page: q.page, pages: Math.ceil(total / q.limit) });
});

export default router;
