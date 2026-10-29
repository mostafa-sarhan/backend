import { Request } from "express";
import { AppError } from "./errors";

// Base filter for every tenant-owned query. Throws if the request has no tenant, so a route that
// forgot authentication can't fall back to "all tenants".
export function scope(req: Request) {
  if (!req.tenant) throw new AppError(500, "INTERNAL_ERROR", "Tenant context missing");
  return { tenantId: req.tenant._id };
}
