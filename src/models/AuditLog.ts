// models/AuditLog.ts
import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    action: String, // CHANGE_ROLE / CHANGE_PASSWORD
    targetUser: String,
    oldValue: String,
    newValue: String,
    changedBy: String,
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);



//-----------------------------------
//------------------------------------


