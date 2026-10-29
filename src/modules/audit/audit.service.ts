import { Request } from "express";
import mongoose from "mongoose";
import { AuditEvent, AUDIT_ENTITIES } from "./auditEvent.model";

type Entity = (typeof AUDIT_ENTITIES)[number];
export type Changes = Record<string, { from: unknown; to: unknown }>;

export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Changes {
  const changes: Changes = {};
  for (const key of Object.keys(after)) {
    const from = before[key] instanceof mongoose.Types.ObjectId ? String(before[key]) : before[key];
    const to = after[key] instanceof mongoose.Types.ObjectId ? String(after[key]) : after[key];
    if (String(from ?? "") !== String(to ?? "")) changes[key] = { from: from ?? null, to: to ?? null };
  }
  return changes;
}

export function auditEvent(
  req: Request,
  event: { entity: Entity; entityId: mongoose.Types.ObjectId | string; action: string; label?: string; changes?: Changes }
) {
  return {
    ...event,
    tenantId: req.tenant!._id,
    entityId: new mongoose.Types.ObjectId(String(event.entityId)),
    actor: req.user ? { id: req.user.id, email: req.user.email } : undefined,
  };
}

export const recordAudit = (req: Request, event: Parameters<typeof auditEvent>[1]) =>
  AuditEvent.create(auditEvent(req, event));
