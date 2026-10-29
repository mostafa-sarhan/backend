import mongoose from "mongoose";

export const ACCESS_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;

// "Request access" form on the landing page; a platform admin approves it into a tenant.
const accessRequestSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    contactName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    message: { type: String, trim: true, maxlength: 1000 },
    status: { type: String, enum: ACCESS_REQUEST_STATUSES, default: "pending", required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },
    reviewedBy: { id: mongoose.Schema.Types.ObjectId, email: String },
    reviewedAt: { type: Date },
    rejectReason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

accessRequestSchema.index({ status: 1, createdAt: -1 });

export const AccessRequest = mongoose.model("AccessRequest", accessRequestSchema);
