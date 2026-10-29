import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";
import { tenantScoped, tenantIdField } from "../lib/tenantPlugin";

export const ROLES = ["owner", "admin", "employee"] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new mongoose.Schema(
  {
    tenantId: tenantIdField,
    // Globally unique: one login, one tenant, no tenant picker.
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ROLES, default: "employee", required: true },
    // Bumped on password/role change or token reuse: invalidates every existing session.
    tokenVersion: { type: Number, default: 0, required: true },
  },
  { timestamps: true }
);

userSchema.plugin(tenantScoped);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, role: 1 });

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = mongoose.model("User", userSchema);

export const ADMIN_ROLES: Role[] = ["owner", "admin"];

export const publicUser = (u: UserDoc) => ({ id: u._id.toString(), email: u.email, role: u.role as Role });
