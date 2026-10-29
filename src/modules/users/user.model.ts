import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";
import { tenantScoped, tenantIdField } from "../../lib/tenantPlugin";

export const ROLES = ["owner", "admin", "employee", "courier", "merchant"] as const;
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
    // Set for one-time passwords (new users, admin resets): the user must pick their own first.
    mustChangePassword: { type: Boolean, default: false, required: true },
    // Links for the courier / merchant roles (step c).
    courierId: { type: mongoose.Schema.Types.ObjectId, ref: "Courier", default: null },
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", default: null },
  },
  { timestamps: true }
);

userSchema.plugin(tenantScoped);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, role: 1 });

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = mongoose.model("User", userSchema);

export const ADMIN_ROLES: Role[] = ["owner", "admin"];
export const STAFF_ROLES: Role[] = ["owner", "admin", "employee"];

export const publicUser = (u: UserDoc) => ({
  id: u._id.toString(),
  email: u.email,
  role: u.role as Role,
  mustChangePassword: !!u.mustChangePassword,
});
