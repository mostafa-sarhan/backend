import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";

export const ROLES = ["admin", "employee"] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ROLES, default: "employee", required: true },
    // Bumped on password/role change or token reuse: invalidates every existing session.
    tokenVersion: { type: Number, default: 0, required: true },
  },
  { timestamps: true }
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = mongoose.model("User", userSchema);

export const publicUser = (u: UserDoc) => ({ id: u._id.toString(), email: u.email, role: u.role as Role });
