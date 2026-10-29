import mongoose from "mongoose";

// Every platform-admin action (who, what, on which target, from where).
const platformAuditEventSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    actor: { id: mongoose.Schema.Types.ObjectId, email: String },
    target: { type: { type: String }, id: mongoose.Schema.Types.ObjectId, label: String },
    changes: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

platformAuditEventSchema.index({ createdAt: -1 });

export const PlatformAuditEvent = mongoose.model("PlatformAuditEvent", platformAuditEventSchema);
