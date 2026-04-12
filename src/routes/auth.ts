import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User";

const router = Router();

// ---------------- AUTH LOGIN ----------------
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ message: "Wrong password" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT secret missing" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { email: user.email, role: user.role },
    });

  } catch (err: any) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
});

// console.log("JWT:", process.env.JWT_SECRET);
// console.log("ENV:", process.env.JWT_SECRET);
// console.log("CWD:", process.cwd());
// console.log("JWT:", process.env.JWT_SECRET);

export default router;
