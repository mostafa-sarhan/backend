import { Request, Response } from "express";
import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { Tenant, TenantDoc, PLAN_LIMITS, TRIAL_DAYS, Plan, TENANT_STATUSES } from "../tenants/tenant.model";
import { User } from "../users/user.model";
import { assertEmailFree } from "../users/users.service";
import { PlatformAdmin } from "./platformAdmin.model";
import { PlatformAuditEvent } from "./platformAuditEvent.model";
import { AccessRequest, ACCESS_REQUEST_STATUSES } from "./accessRequest.model";
import { recordPlatformAudit } from "./platformAudit.service";
import { hashPassword, verifyPassword, needsRehash, assertStrongPassword } from "../auth/password";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllSessions,
  revokeTenantSessions,
  setSessionCookies,
  clearSessionCookies,
} from "../auth/tokens";
import { diff } from "../audit/audit.service";
import { AppError, notFound } from "../../lib/errors";
import { withTransaction } from "../../lib/transaction";
import { UpdateTenantInput, accessRequestBody } from "./platform.schemas";
import { loginGuard } from "../../lib/rateLimit";

const guard = loginGuard("platform");

const DAY_MS = 24 * 60 * 60 * 1000;

// Random password that meets the policy; shown once, the user must change it on first login.
export const generateInitialPassword = () => `${randomBytes(12).toString("base64url")}a7`;

const page = async <T>(query: mongoose.Query<T[], unknown>, count: Promise<number>, p: { page: number; limit: number }) => {
  const [items, total] = await Promise.all([query.skip((p.page - 1) * p.limit).limit(p.limit), count]);
  return { items, meta: { total, page: p.page, pages: Math.ceil(total / p.limit) } };
};

// ---------------- Platform-admin sessions ----------------
export async function login(req: Request, res: Response, email: string, password: string) {
  await guard.assertNotLocked(req, email);
  const admin = await PlatformAdmin.findOne({ email });
  if (!admin || !(await verifyPassword(password, admin.password))) {
    await guard.recordFailure(email);
    await recordPlatformAudit(req, { action: "LOGIN_FAILED", target: { type: "platform_admin", label: email } });
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  await guard.recordSuccess(email);
  if (needsRehash(admin.password)) {
    admin.password = await hashPassword(password);
    await admin.save();
  }
  const { token } = await issueRefreshToken("platform", admin);
  setSessionCookies(res, "platform", signAccessToken("platform", admin), token);
  req.platformAdmin = { id: admin._id.toString(), email: admin.email };
  await recordPlatformAudit(req, { action: "LOGIN" });
  return { admin: { ...req.platformAdmin, mustChangePassword: admin.mustChangePassword } };
}

export async function refresh(res: Response, token: string | undefined) {
  try {
    const { subject, refreshToken } = await rotateRefreshToken("platform", token);
    const admin = subject as InstanceType<typeof PlatformAdmin>;
    setSessionCookies(res, "platform", signAccessToken("platform", admin), refreshToken);
    return { admin: { id: admin._id.toString(), email: admin.email, mustChangePassword: admin.mustChangePassword } };
  } catch (err) {
    clearSessionCookies(res, "platform");
    throw err;
  }
}

export async function logout(res: Response, token: string | undefined) {
  await revokeRefreshToken(token);
  clearSessionCookies(res, "platform");
}

export async function changeOwnPassword(req: Request, res: Response, currentPassword: string, newPassword: string) {
  const admin = await PlatformAdmin.findById(req.platformAdmin!.id);
  if (!admin) throw new AppError(401, "SESSION_EXPIRED", "Session expired");
  await guard.assertNotLocked(req, admin.email);
  if (!(await verifyPassword(currentPassword, admin.password))) {
    await guard.recordFailure(admin.email);
    throw new AppError(401, "INVALID_CREDENTIALS", "Current password is wrong");
  }
  if (await verifyPassword(newPassword, admin.password)) throw new AppError(400, "WEAK_PASSWORD", "Choose a different password", ["Must differ from the current password"]);
  assertStrongPassword(newPassword, admin.email);
  admin.password = await hashPassword(newPassword);
  admin.mustChangePassword = false;
  await admin.save();
  await revokeAllSessions("platform", admin._id);
  await recordPlatformAudit(req, { action: "CHANGE_OWN_PASSWORD" });
  const fresh = (await PlatformAdmin.findById(admin._id))!;
  const { token } = await issueRefreshToken("platform", fresh);
  setSessionCookies(res, "platform", signAccessToken("platform", fresh), token);
  return { admin: { id: fresh._id.toString(), email: fresh.email, mustChangePassword: false } };
}

// ---------------- Tenants ----------------
export const tenantSummary = (t: TenantDoc) => ({
  _id: t._id,
  name: t.name,
  slug: t.slug,
  plan: t.plan,
  status: t.status,
  trialEndsAt: t.trialEndsAt,
  limits: t.limits,
  createdAt: t.createdAt,
});

export async function listTenants(q: { page: number; limit: number; status?: (typeof TENANT_STATUSES)[number] }) {
  const filter = q.status ? { status: q.status } : {};
  const { items, meta } = await page(Tenant.find(filter).sort({ createdAt: -1 }), Tenant.countDocuments(filter), q);
  return { items: items.map(tenantSummary), meta };
}

async function uniqueSlug(name: string, wanted?: string) {
  const base =
    (wanted || name)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `company-${randomBytes(3).toString("hex")}`;
  if (wanted && (await Tenant.exists({ slug: base }))) throw new AppError(409, "DUPLICATE", "Slug already taken");
  let slug = base;
  for (let i = 2; await Tenant.exists({ slug }); i++) slug = `${base}-${i}`;
  return slug;
}

export const planDefaults = (plan: Plan) => ({
  plan,
  limits: { ...PLAN_LIMITS[plan] },
  status: plan === "trial" ? ("trial" as const) : ("active" as const),
  trialEndsAt: plan === "trial" ? new Date(Date.now() + TRIAL_DAYS * DAY_MS) : null,
});

// New tenant + its first owner (one-time password), in one transaction. Call inside withTransaction.
async function insertTenantWithOwner(input: { name: string; slug?: string; plan: Plan; ownerEmail: string }) {
  await assertEmailFree(input.ownerEmail);
  const initialPassword = generateInitialPassword();
  const password = await hashPassword(initialPassword);
  const slug = await uniqueSlug(input.name, input.slug);
  const [tenant] = await Tenant.create([{ name: input.name, slug, ...planDefaults(input.plan) }]);
  const [owner] = await User.create([{ tenantId: tenant._id, email: input.ownerEmail, role: "owner", password, mustChangePassword: true }]);
  return { tenant, owner, initialPassword };
}

export async function createTenant(req: Request, input: { name: string; slug?: string; plan: Plan; ownerEmail: string }) {
  return withTransaction(async () => {
    const { tenant, owner, initialPassword } = await insertTenantWithOwner(input);
    await recordPlatformAudit(req, { action: "CREATE_TENANT", target: { type: "tenant", id: tenant._id, label: tenant.name }, changes: { owner: { from: null, to: owner.email } } });
    return { tenant: tenantSummary(tenant), owner: { email: owner.email }, initialPassword };
  });
}

export async function updateTenant(req: Request, id: string, body: UpdateTenantInput) {
  return withTransaction(async () => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw notFound("Tenant");
    const snapshot = () => ({ name: tenant.name, plan: tenant.plan, status: tenant.status, trialEndsAt: tenant.trialEndsAt, ...tenant.limits });
    const before = snapshot();

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
    await recordPlatformAudit(req, { action: "UPDATE_TENANT", target: { type: "tenant", id: tenant._id, label: tenant.name }, changes: diff(before, snapshot()) });
    return tenantSummary(tenant);
  });
}

// ---------------- Access requests ----------------
// Always the same answer, so the public form can't be used to learn who applied.
// Honeypot filled -> pretend success, store nothing.
export async function submitAccessRequest(input: z.infer<typeof accessRequestBody>) {
  const { website, ...data } = input;
  if (website) return { received: true };
  if (!(await AccessRequest.exists({ email: data.email, status: "pending" }))) await AccessRequest.create(data);
  return { received: true };
}

export const listAccessRequests = (q: { page: number; limit: number; status?: (typeof ACCESS_REQUEST_STATUSES)[number] }) => {
  const filter = q.status ? { status: q.status } : {};
  return page(AccessRequest.find(filter).sort({ createdAt: -1 }).lean(), AccessRequest.countDocuments(filter), q);
};

const reviewer = (req: Request) => ({ id: new mongoose.Types.ObjectId(req.platformAdmin!.id), email: req.platformAdmin!.email });

async function pendingRequest(id: string) {
  const request = await AccessRequest.findById(id);
  if (!request) throw notFound("Access request");
  if (request.status !== "pending") throw new AppError(409, "CONFLICT", "This request was already reviewed");
  return request;
}

// Creates the tenant and its owner (the requester's email); returns the initial password once.
export async function approveAccessRequest(req: Request, id: string, opts: { plan: Plan; slug?: string }) {
  return withTransaction(async () => {
    const request = await pendingRequest(id);
    const { tenant, owner, initialPassword } = await insertTenantWithOwner({ name: request.companyName, slug: opts.slug, plan: opts.plan, ownerEmail: request.email });
    request.set({ status: "approved", tenantId: tenant._id, reviewedBy: reviewer(req), reviewedAt: new Date() });
    await request.save();
    await recordPlatformAudit(req, { action: "APPROVE_ACCESS_REQUEST", target: { type: "access_request", id: request._id, label: request.companyName }, changes: { tenant: { from: null, to: tenant._id.toString() } } });
    return { tenant: tenantSummary(tenant), owner: { email: owner.email }, initialPassword };
  });
}

export async function rejectAccessRequest(req: Request, id: string, reason?: string) {
  return withTransaction(async () => {
    const request = await pendingRequest(id);
    request.set({ status: "rejected", rejectReason: reason, reviewedBy: reviewer(req), reviewedAt: new Date() });
    await request.save();
    await recordPlatformAudit(req, { action: "REJECT_ACCESS_REQUEST", target: { type: "access_request", id: request._id, label: request.companyName } });
    return request;
  });
}

export const listPlatformAudit = (q: { page: number; limit: number }) =>
  page(PlatformAuditEvent.find().sort({ createdAt: -1 }).lean(), PlatformAuditEvent.countDocuments(), q);
