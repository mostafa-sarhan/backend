import mongoose from "mongoose";

export const REALMS = ["tenant", "platform"] as const;
export type Realm = (typeof REALMS)[number];

// One document per refresh token. Rotated on every refresh; a revoked token presented again
// means it was stolen, so the whole session family is revoked.
// Not tenant-scoped by the plugin: tokens are looked up by id before the tenant is known.
const refreshTokenSchema = new mongoose.Schema(
  {
    realm: { type: String, enum: REALMS, required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, required: true }, // User or PlatformAdmin
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },
    tokenHash: { type: String, required: true },
    tokenVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ realm: 1, subject: 1 });
refreshTokenSchema.index({ tenantId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup

export const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
