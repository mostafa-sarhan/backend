import { Request, Response, NextFunction } from "express";
import { ok, created } from "../../lib/respond";
import { idParams, pagination } from "../../lib/validate";
import { loginBody, changePasswordBody } from "../auth/auth.schemas";
import { cookieNames } from "../auth/tokens";
import { recordPlatformAudit } from "./platformAudit.service";
import { tenantListQuery, createTenantBody, updateTenantBody, accessRequestListQuery, approveBody, rejectBody, accessRequestBody } from "./platform.schemas";
import * as platform from "./platform.service";

const refreshCookie = (req: Request) => req.cookies?.[cookieNames("platform").refresh];

export async function login(req: Request, res: Response) {
  const { email, password } = loginBody.parse(req.body);
  ok(res, await platform.login(req, res, email, password));
}
export async function refresh(req: Request, res: Response) {
  ok(res, await platform.refresh(res, refreshCookie(req)));
}
export async function logout(req: Request, res: Response) {
  await platform.logout(res, refreshCookie(req));
  ok(res, { loggedOut: true });
}
export function me(req: Request, res: Response) {
  ok(res, { admin: req.platformAdmin });
}
export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
  ok(res, await platform.changeOwnPassword(req, res, currentPassword, newPassword));
}

// Reads are audited too: platform admins can see every tenant's account data.
export function auditReads(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET") {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      recordPlatformAudit(req, { action: "VIEW", target: { type: "route", label: req.originalUrl.slice(0, 200) } }).catch((err) =>
        req.log.error({ err }, "Platform audit write failed")
      );
    });
  }
  next();
}

export async function listTenants(req: Request, res: Response) {
  const { items, meta } = await platform.listTenants(tenantListQuery.parse(req.query));
  ok(res, items, meta);
}
export async function createTenant(req: Request, res: Response) {
  created(res, await platform.createTenant(req, createTenantBody.parse(req.body)));
}
export async function updateTenant(req: Request, res: Response) {
  ok(res, await platform.updateTenant(req, idParams.parse(req.params).id, updateTenantBody.parse(req.body)));
}

export async function listAccessRequests(req: Request, res: Response) {
  const { items, meta } = await platform.listAccessRequests(accessRequestListQuery.parse(req.query));
  ok(res, items, meta);
}
export async function approve(req: Request, res: Response) {
  created(res, await platform.approveAccessRequest(req, idParams.parse(req.params).id, approveBody.parse(req.body ?? {})));
}
export async function reject(req: Request, res: Response) {
  ok(res, await platform.rejectAccessRequest(req, idParams.parse(req.params).id, rejectBody.parse(req.body ?? {}).reason));
}

export async function auditLog(req: Request, res: Response) {
  const { items, meta } = await platform.listPlatformAudit(pagination.parse(req.query));
  ok(res, items, meta);
}

// Public
export async function submitAccessRequest(req: Request, res: Response) {
  created(res, await platform.submitAccessRequest(accessRequestBody.parse(req.body)));
}
