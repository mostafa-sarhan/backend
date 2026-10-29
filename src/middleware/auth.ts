import { RequestHandler } from "express";
import { User, Role, ADMIN_ROLES } from "../models/User";
import { AppError, forbidden } from "../lib/errors";
import { cookieNames, verifyAccessToken } from "../lib/tokens";
import { loadUsableTenant } from "../services/tenants";

// Authenticates a tenant user via the httpOnly access-token cookie. User and tenant are re-read on
// every request, so role changes, bumped tokenVersions and tenant suspension apply immediately.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[cookieNames("tenant").access];
  if (!token) return next(new AppError(401, "UNAUTHENTICATED", "Not logged in"));

  let payload;
  try {
    payload = verifyAccessToken("tenant", token);
  } catch {
    return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));
  }
  if (!payload.tid) return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));

  const tenant = await loadUsableTenant(payload.tid);
  const user = await User.findOne({ _id: payload.sub, tenantId: tenant._id }).select("email role tokenVersion");
  if (!user || user.tokenVersion !== payload.tv) return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));

  req.tenant = tenant;
  req.user = { id: user._id.toString(), email: user.email, role: user.role as Role };
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) =>
    req.user && roles.includes(req.user.role) ? next() : next(forbidden());

// Owners have every admin right.
export const adminOnly = requireRole(...ADMIN_ROLES);
export const ownerOnly = requireRole("owner");
