import { Request } from "express";

// Base filter for every tenant-owned query. Phase C adds `tenantId` here (and as the
// first key of each compound index), so no query needs to change individually.
export function scope(_req?: Request): Record<string, unknown> {
  return {};
}
