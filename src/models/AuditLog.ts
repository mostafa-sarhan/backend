import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    action: String, // CREATE_USER / CHANGE_ROLE / CHANGE_PASSWORD
    targetUser: String,
    oldValue: String,
    newValue: String,
    changedBy: String,
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
