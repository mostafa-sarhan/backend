import { Request } from "express";
import mongoose from "mongoose";
import { PlatformAuditEvent } from "../models/PlatformAuditEvent";
import { Changes } from "./audit";

// Every platform-admin action is recorded.
export const recordPlatformAudit = (
  req: Request,
  event: { action: string; target?: { type: string; id?: mongoose.Types.ObjectId | string; label?: string }; changes?: Changes }
) =>
  PlatformAuditEvent.create({
    action: event.action,
    actor: req.platformAdmin ? { id: req.platformAdmin.id, email: req.platformAdmin.email } : undefined,
    target: event.target,
    changes: event.changes,
    ip: req.ip,
  });
