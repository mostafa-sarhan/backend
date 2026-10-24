import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { User } from "../models/User";
import { config } from "../config";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many login attempts, try again later" },
});

const isBcryptHash = (value: string) => /^\$2[aby]\$\d{2}\$/.test(value);

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email });
    // Same message for unknown email and wrong password, so emails can't be probed.
    const invalid = () => res.status(401).json({ message: "Invalid email or password" });
    if (!user) return invalid();

    if (isBcryptHash(user.password)) {
      if (!(await bcrypt.compare(password, user.password))) return invalid();
    } else {
      // Legacy plain-text password: verify, then upgrade it to a hash.
      if (password !== user.password) return invalid();
      user.password = await bcrypt.hash(password, 10);
      await user.save();
    }

    const token = jwt.sign({ id: user._id, role: user.role }, config.jwtSecret, { expiresIn: "7d" });

    return res.json({ token, user: { email: user.email, role: user.role } });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
