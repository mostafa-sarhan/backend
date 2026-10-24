import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";

const merchantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // API key: only its SHA-256 is stored; the key itself is shown once on creation/rotation.
    apiKeyHash: { type: String, select: false },
    apiKeyPrefix: { type: String }, // first characters, to recognise the key in the UI
    apiKeyCreatedAt: { type: Date },
    apiKeyRevokedAt: { type: Date },
  },
  { timestamps: true }
);

// Phase C: becomes { tenantId: 1, name: 1 }.
merchantSchema.index({ name: 1 }, { unique: true });
merchantSchema.index({ apiKeyHash: 1 }, { unique: true, sparse: true });

export type MerchantDocument = HydratedDocument<InferSchemaType<typeof merchantSchema>>;
export const Merchant = mongoose.model("Merchant", merchantSchema);

export const publicMerchant = (m: MerchantDocument) => ({
  _id: m._id,
  name: m.name,
  apiKeyPrefix: m.apiKeyPrefix ?? null,
  hasActiveKey: !!m.apiKeyPrefix && !m.apiKeyRevokedAt,
  apiKeyCreatedAt: m.apiKeyCreatedAt ?? null,
  apiKeyRevokedAt: m.apiKeyRevokedAt ?? null,
  createdAt: m.createdAt,
});
