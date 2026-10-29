import { ErrorRequestHandler, RequestHandler } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";

// Stable, English error codes. The frontend maps them to user-facing (Arabic) text.
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_ID"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "FORBIDDEN_FIELDS"
  | "CSRF_REJECTED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE"
  | "INVALID_STATUS_TRANSITION"
  | "WEAK_PASSWORD"
  | "LAST_ADMIN"
  | "LAST_OWNER"
  | "TENANT_SUSPENDED"
  | "TRIAL_EXPIRED"
  | "PLAN_LIMIT_REACHED"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You don't have permission to do this") => new AppError(403, "FORBIDDEN", message);

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound("Route"));

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return new AppError(400, "VALIDATION_ERROR", "Invalid request data", details);
  }
  if (err instanceof mongoose.Error.CastError) return new AppError(400, "INVALID_ID", `Invalid ${err.path}`);
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return new AppError(400, "VALIDATION_ERROR", "Invalid request data", details);
  }
  const e = err as { code?: number; keyPattern?: Record<string, unknown>; type?: string; status?: number };
  if (e?.code === 11000) {
    return new AppError(409, "DUPLICATE", "Already exists", { fields: Object.keys(e.keyPattern || {}) });
  }
  if (e?.type === "entity.too.large") return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
  if (e?.type === "entity.parse.failed") return new AppError(400, "VALIDATION_ERROR", "Malformed JSON body");
  return new AppError(500, "INTERNAL_ERROR", "Internal server error");
}

// Every error leaves the API as { error: { code, message, details?, requestId } }.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);
  if (appError.status >= 500) req.log?.error({ err }, "Unhandled error");
  else req.log?.debug({ code: appError.code }, appError.message);

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
      requestId: req.id,
    },
  });
};
