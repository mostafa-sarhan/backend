import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User";

const router = Router();

// ---------------- AUTH LOGIN ----------------
// router.post("/login", async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     if (!email || !password) {
//       return res.status(400).json({ message: "Email and password required" });
//     }

//     const user = await User.findOne({ email });
//     if (!user) {
//       return res.status(401).json({ message: "User not found" });
//     }

//     if (!user.password) {
//       return res.status(500).json({ message: "User password missing in DB" });
//     }

//     const match = await bcrypt.compare(password, user.password);

//     if (!match) {
//       return res.status(401).json({ message: "Wrong password" });
//     }

//     const token = jwt.sign(
//       { id: user._id, role: user.role },
//       process.env.JWT_SECRET!,
//       { expiresIn: "7d" }
//     );

//     res.json({
//       token,
//       user: { email: user.email, role: user.role },
//     });

//   } catch (err: any) {
//     console.error("🔥 LOGIN ERROR:", err);
//     res.status(500).json({
//       message: err.message,
//     });
//   }
// });

router.post("/login", async (req, res) => {
  try {
    console.log("🔥 BODY:", req.body);

    const { email, password } = req.body;

    const user = await User.findOne({ email });

    console.log("👤 USER:", user);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    console.log("🔑 PASSWORD FROM DB:", user.password);

    const match = await bcrypt.compare(password, user.password);

    return res.json({ match });

  } catch (err: any) {
    console.error("💥 LOGIN ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// console.log("JWT:", process.env.JWT_SECRET);
// console.log("ENV:", process.env.JWT_SECRET);
// console.log("CWD:", process.cwd());
// console.log("JWT:", process.env.JWT_SECRET);

export default router;
