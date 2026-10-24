import { RequestHandler } from "express";
import { User, Role } from "../models/User";
import { AppError, forbidden } from "../lib/errors";
import { ACCESS_COOKIE, verifyAccessToken } from "../lib/tokens";

// Authenticates via the httpOnly access-token cookie. The user is re-read on every request,
// so role changes apply immediately and bumped tokenVersions reject old tokens.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next(new AppError(401, "UNAUTHENTICATED", "Not logged in"));

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));
  }

  const user = await User.findById(payload.sub).select("email role tokenVersion");
  if (!user || user.tokenVersion !== payload.tv) return next(new AppError(401, "SESSION_EXPIRED", "Session expired"));

  req.user = { id: user._id.toString(), email: user.email, role: user.role as Role };
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) =>
    req.user && roles.includes(req.user.role) ? next() : next(forbidden());

export const adminOnly = requireRole("admin");
