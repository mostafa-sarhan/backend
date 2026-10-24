import { RequestHandler } from "express";
import { AppError } from "../lib/errors";
import { config } from "../config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Cookie auth needs CSRF protection: state-changing browser requests must come from an allowed origin.
// Requests without an Origin header (curl, server-to-server, merchant API) are not browser CSRF and pass.
export const originCheck: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !config.corsOrigins.includes(origin)) {
    return next(new AppError(403, "CSRF_REJECTED", "Origin not allowed"));
  }
  next();
};
