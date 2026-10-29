import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";
import { tenantScoped, tenantIdField } from "../../lib/tenantPlugin";

const merchantSchema = new mongoose.Schema(
  {
    tenantId: tenantIdField,
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Overrides the tenant's company fee for this merchant (null = tenant default).
    companyFee: { type: Number, default: null, min: 0 },
    // API key: only its SHA-256 is stored; the key itself is shown once on creation/rotation.
    apiKeyHash: { type: String, select: false },
    apiKeyPrefix: { type: String }, // first characters, to recognise the key in the UI
    apiKeyCreatedAt: { type: Date },
    apiKeyRevokedAt: { type: Date },
  },
  { timestamps: true }
);

merchantSchema.plugin(tenantScoped);
merchantSchema.index({ tenantId: 1, name: 1 }, { unique: true });
// Globally unique: the key alone identifies merchant and tenant.
merchantSchema.index({ apiKeyHash: 1 }, { unique: true, sparse: true });

export type MerchantDocument = HydratedDocument<InferSchemaType<typeof merchantSchema>>;
export const Merchant = mongoose.model("Merchant", merchantSchema);

export const publicMerchant = (m: MerchantDocument) => ({
  _id: m._id,
  name: m.name,
  companyFee: m.companyFee ?? null,
  apiKeyPrefix: m.apiKeyPrefix ?? null,
  hasActiveKey: !!m.apiKeyPrefix && !m.apiKeyRevokedAt,
  apiKeyCreatedAt: m.apiKeyCreatedAt ?? null,
  apiKeyRevokedAt: m.apiKeyRevokedAt ?? null,
  createdAt: m.createdAt,
});
