import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { auth } from "../middleware/auth";
import { adminOnly } from "../middleware/adminOnly";
import { AuditLog } from "../models/AuditLog";

const router = Router();
// ---------------- USERS ----------------

// Get all users
router.get("/", auth, adminOnly, async (_, res: Response) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Create user
router.post("/", auth, adminOnly, async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role)
      return res.status(400).json({ message: "All fields are required" });

    if (!["user", "admin"].includes(role))
      return res.status(400).json({ message: "Invalid role" });

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = await User.create({ email, password: hashed, role });

    await AuditLog.create({
      action: "CREATE_USER",
      targetUser: email,
      oldValue: null,
      newValue: role,
      changedBy: (req as any).user!.email,
    });

    res.status(201).json({
      message: "User created successfully",
      user: { email: newUser.email, role: newUser.role },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Change password
router.put("/password", auth, adminOnly, async (req: Request, res: Response) => {
  try {
    const { email, newPassword } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    await AuditLog.create({
      action: "CHANGE_PASSWORD",
      targetUser: email,
      oldValue: "***",
      newValue: "***",
      changedBy: (req as any).user!.email,
    });

    res.json({ message: "Password updated" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Change role
router.put("/role", auth, adminOnly, async (req: Request, res: Response) => {
  try {
    const { targetEmail, newRole } = req.body;

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
      changedBy: (req as any).user!.email,
    });

    res.json({ message: "Role updated" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


// Get all audit logs
router.get("/auditlogs", auth, adminOnly, async (_, res: Response) => {
  try {
    const logs = await AuditLog.find().sort({ date: -1 }); // ترتيب من الأحدث
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


export default router;
