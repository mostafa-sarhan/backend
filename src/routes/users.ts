import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User, ROLES, Role } from "../models/User";
import { auth } from "../middleware/auth";
import { adminOnly } from "../middleware/adminOnly";
import { AuditLog } from "../models/AuditLog";

const router = Router();
router.use(auth, adminOnly);

const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

// Get all users
router.get("/", async (_req, res: Response) => {
  try {
    res.json(await User.find().select("-password"));
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Create user
router.post("/", async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body ?? {};

    if (!email || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!isRole(role)) return res.status(400).json({ message: "Invalid role" });

    if (await User.exists({ email })) {
      return res.status(400).json({ message: "User already exists" });
    }

    const newUser = await User.create({ email, password: await bcrypt.hash(password, 10), role });

    await AuditLog.create({
      action: "CREATE_USER",
      targetUser: email,
      newValue: role,
      changedBy: req.user!.email,
    });

    res.status(201).json({
      message: "User created successfully",
      user: { email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Change password
router.put("/password", async (req: Request, res: Response) => {
  try {
    const { email, newPassword } = req.body ?? {};
    if (!email || !newPassword) return res.status(400).json({ message: "Email and new password required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    await AuditLog.create({
      action: "CHANGE_PASSWORD",
      targetUser: email,
      oldValue: "***",
      newValue: "***",
      changedBy: req.user!.email,
    });

    res.json({ message: "Password updated" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Change role
router.put("/role", async (req: Request, res: Response) => {
  try {
    const { targetEmail, newRole } = req.body ?? {};
    if (!isRole(newRole)) return res.status(400).json({ message: "Invalid role" });

    const user = await User.findOne({ email: targetEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    const oldRole = user.role;
    user.role = newRole;
    await user.save();

    await AuditLog.create({
      action: "CHANGE_ROLE",
      targetUser: targetEmail,
      oldValue: oldRole,
      newValue: newRole,
      changedBy: req.user!.email,
    });

    res.json({ message: "Role updated" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Get all audit logs
router.get("/auditlogs", async (_req, res: Response) => {
  try {
    res.json(await AuditLog.find().sort({ createdAt: -1 }));
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
