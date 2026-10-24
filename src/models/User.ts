import mongoose from "mongoose";

export const ROLES = ["admin", "employee"] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ROLES, default: "employee" },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
