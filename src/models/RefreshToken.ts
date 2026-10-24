import mongoose from "mongoose";

// One document per refresh token. Rotated on every refresh; a revoked token presented again
// means it was stolen, so the whole session family is revoked.
const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true },
    tokenVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup

export const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
