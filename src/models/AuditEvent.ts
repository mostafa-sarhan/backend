import mongoose from "mongoose";
import { tenantScoped, tenantIdField } from "../lib/tenantPlugin";

export const AUDIT_ENTITIES = ["user", "order", "merchant", "courier"] as const;

// Who changed what. `changes` is { field: { from, to } }.
const auditEventSchema = new mongoose.Schema(
  {
    tenantId: tenantIdField,
    entity: { type: String, enum: AUDIT_ENTITIES, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    action: { type: String, required: true }, // e.g. CREATE, UPDATE, STATUS_CHANGE, DELETE, CHANGE_ROLE
    actor: {
      id: { type: mongoose.Schema.Types.ObjectId },
      email: { type: String },
    },
    label: { type: String }, // human-readable target, e.g. user email or order barcode
    changes: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditEventSchema.plugin(tenantScoped);
auditEventSchema.index({ tenantId: 1, entity: 1, entityId: 1, createdAt: -1 });
auditEventSchema.index({ tenantId: 1, createdAt: -1 });

export const AuditEvent = mongoose.model("AuditEvent", auditEventSchema);
