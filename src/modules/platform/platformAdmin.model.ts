import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";

// Operators of the SaaS itself. Separate collection, separate login and cookies:
// a platform admin never acts inside a tenant.
const platformAdminSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    tokenVersion: { type: Number, default: 0, required: true },
    // Generated passwords (npm run platform-admin) must be changed on first login.
    mustChangePassword: { type: Boolean, default: true, required: true },
  },
  { timestamps: true }
);

platformAdminSchema.index({ email: 1 }, { unique: true });

export type PlatformAdminDoc = HydratedDocument<InferSchemaType<typeof platformAdminSchema>>;
export const PlatformAdmin = mongoose.model("PlatformAdmin", platformAdminSchema);
