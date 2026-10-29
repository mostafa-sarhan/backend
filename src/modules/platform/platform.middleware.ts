import { RequestHandler } from "express";
import { PlatformAdmin } from "./platformAdmin.model";
import { AppError } from "../../lib/errors";
import { cookieNames, verifyAccessToken } from "../auth/tokens";

// Platform-admin session: own cookie (path /platform) and JWT audience. Tenant tokens don't work here.
function authenticate({ allowPendingPasswordChange }: { allowPendingPasswordChange: boolean }): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.[cookieNames("platform").access];
    if (!token) return next(new AppError(401, "UNAUTHENTICATED", "Not logged in"));

    let payload;
    try {
      payload = verifyAccessToken("platform", token);
    } catch {
      return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));
    }

    const admin = await PlatformAdmin.findById(payload.sub).select("email tokenVersion mustChangePassword");
    if (!admin || admin.tokenVersion !== payload.tv) return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));
    if (admin.mustChangePassword && !allowPendingPasswordChange) {
      return next(new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Change your password first"));
    }

    req.platformAdmin = { id: admin._id.toString(), email: admin.email, mustChangePassword: admin.mustChangePassword };
    next();
  };
}

export const requirePlatformAdmin = authenticate({ allowPendingPasswordChange: false });
export const requirePlatformAdminAllowingPasswordChange = authenticate({ allowPendingPasswordChange: true });
