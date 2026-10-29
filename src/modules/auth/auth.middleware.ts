import { RequestHandler } from "express";
import { User, Role, ADMIN_ROLES, STAFF_ROLES } from "../users/user.model";
import { AppError, forbidden } from "../../lib/errors";
import { cookieNames, verifyAccessToken } from "./tokens";
import { loadUsableTenant } from "../tenants/tenants.service";
import { limits } from "../../lib/rateLimit";

// Authenticates a tenant user via the httpOnly access-token cookie. User and tenant are re-read on
// every request, so role changes, bumped tokenVersions and tenant suspension apply immediately.
// Users with a one-time password can only reach the routes that let them change it.
function authenticate({ allowPendingPasswordChange }: { allowPendingPasswordChange: boolean }): RequestHandler {
  return async (req, _res, next) => {
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
    const user = await User.findOne({ _id: payload.sub, tenantId: tenant._id }).select("email role tokenVersion mustChangePassword courierId merchantId");
    if (!user || user.tokenVersion !== payload.tv) return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));
    if (user.mustChangePassword && !allowPendingPasswordChange) {
      return next(new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Change your password first"));
    }

    req.tenant = tenant;
    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role as Role,
      mustChangePassword: user.mustChangePassword,
      courierId: user.courierId?.toString(),
      merchantId: user.merchantId?.toString(),
    };
    next();
  };
}

// Authenticated API limits: per user, plus a ceiling per tenant.
export const requireAuth = [authenticate({ allowPendingPasswordChange: false }), limits.user, limits.tenant];
export const requireAuthAllowingPasswordChange = [authenticate({ allowPendingPasswordChange: true }), limits.user, limits.tenant];

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) =>
    req.user && roles.includes(req.user.role) ? next() : next(forbidden());

// Owners have every admin right. Staff = the company's own team (not couriers or merchants).
export const adminOnly = requireRole(...ADMIN_ROLES);
export const staffOnly = requireRole(...STAFF_ROLES);
export const ownerOnly = requireRole("owner");
