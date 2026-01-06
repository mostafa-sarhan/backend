import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "./models/User";

dotenv.config();

async function seed() {
  await mongoose.connect(process.env.MONGO_URI!);

  const hashed = await bcrypt.hash("123456", 10);

  await User.updateOne(
    { email: "admin@test.com" },
    { $set: { password: hashed, role: "admin" } },
    { upsert: true }
  );

  console.log("✅ Admin ready");
  process.exit();
}

seed();
