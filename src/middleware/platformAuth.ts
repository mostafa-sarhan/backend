import { RequestHandler } from "express";
import { PlatformAdmin } from "../models/PlatformAdmin";
import { AppError } from "../lib/errors";
import { cookieNames, verifyAccessToken } from "../lib/tokens";

// Platform-admin session: own cookie (path /platform) and JWT audience. Tenant tokens don't work here.
export const requirePlatformAdmin: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[cookieNames("platform").access];
  if (!token) return next(new AppError(401, "UNAUTHENTICATED", "Not logged in"));

  let payload;
  try {
    payload = verifyAccessToken("platform", token);
  } catch {
    return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));
  }

  const admin = await PlatformAdmin.findById(payload.sub).select("email tokenVersion");
  if (!admin || admin.tokenVersion !== payload.tv) return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));

  req.platformAdmin = { id: admin._id.toString(), email: admin.email };
  next();
};
