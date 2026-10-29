import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";

export const PLANS = ["trial", "starter", "pro"] as const;
export type Plan = (typeof PLANS)[number];
export const TENANT_STATUSES = ["trial", "active", "suspended"] as const;

// null = unlimited
export const PLAN_LIMITS: Record<Plan, { maxUsers: number | null; maxOrdersPerMonth: number | null }> = {
  trial: { maxUsers: 5, maxOrdersPerMonth: 1000 },
  starter: { maxUsers: 10, maxOrdersPerMonth: 3000 },
  pro: { maxUsers: null, maxOrdersPerMonth: null },
};
export const TRIAL_DAYS = 14;

// A shipping company using the platform.
const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 60, match: /^[a-z0-9-]+$/ },
    // Subscription (no payment integration yet)
    plan: { type: String, enum: PLANS, default: "trial", required: true },
    status: { type: String, enum: TENANT_STATUSES, default: "trial", required: true },
    trialEndsAt: { type: Date, default: null },
    limits: {
      maxUsers: { type: Number, default: null, min: 1 },
      maxOrdersPerMonth: { type: Number, default: null, min: 1 },
    },
    settings: {
      fees: {
        courier: { type: Number, default: 20, min: 0 },
        company: { type: Number, default: 20, min: 0 },
      },
      merchantDeductions: { type: [String], enum: ["company", "courier"], default: ["company"] },
      archiveAfterDays: { type: Number, default: 3, min: 1, max: 365 },
      timezone: { type: String, default: "Africa/Cairo" },
      currency: { type: String, default: "EGP" },
      labelName: { type: String, trim: true, maxlength: 120 },
      logoUrl: { type: String, trim: true, maxlength: 500 },
    },
  },
  { timestamps: true }
);

tenantSchema.index({ slug: 1 }, { unique: true });

export type TenantDoc = HydratedDocument<InferSchemaType<typeof tenantSchema>>;
export const Tenant = mongoose.model("Tenant", tenantSchema);

// Why a tenant may not use the app right now, or null if it may.
export function tenantBlock(t: Pick<TenantDoc, "status" | "trialEndsAt">, now = new Date()) {
  if (t.status === "suspended") return "TENANT_SUSPENDED" as const;
  if (t.status === "trial" && t.trialEndsAt && t.trialEndsAt < now) return "TRIAL_EXPIRED" as const;
  return null;
}
