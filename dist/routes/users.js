"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const User_1 = require("../models/User");
const auth_1 = require("../middleware/auth");
const adminOnly_1 = require("../middleware/adminOnly");
const AuditLog_1 = require("../models/AuditLog");
const router = (0, express_1.Router)();
// ---------------- USERS ----------------
// Get all users
router.get("/", auth_1.auth, adminOnly_1.adminOnly, async (_, res) => {
    try {
        const users = await User_1.User.find().select("-password");
        res.json(users);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Create user
router.post("/", auth_1.auth, adminOnly_1.adminOnly, async (req, res) => {
    try {
        const { email, password, role } = req.body;
        if (!email || !password || !role)
            return res.status(400).json({ message: "All fields are required" });
        if (!["user", "admin"].includes(role))
            return res.status(400).json({ message: "Invalid role" });
        const existingUser = await User_1.User.findOne({ email });
        if (existingUser)
            return res.status(400).json({ message: "User already exists" });
        const hashed = await bcryptjs_1.default.hash(password, 10);
        const newUser = await User_1.User.create({ email, password: hashed, role });
        await AuditLog_1.AuditLog.create({
            action: "CREATE_USER",
            targetUser: email,
            oldValue: null,
            newValue: role,
            changedBy: req.user.email,
        });
        res.status(201).json({
            message: "User created successfully",
            user: { email: newUser.email, role: newUser.role },
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
});
// Change password
router.put("/password", auth_1.auth, adminOnly_1.adminOnly, async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        const user = await User_1.User.findOne({ email });
        if (!user)
            return res.status(404).json({ message: "User not found" });
        user.password = await bcryptjs_1.default.hash(newPassword, 10);
        await user.save();
        await AuditLog_1.AuditLog.create({
            action: "CHANGE_PASSWORD",
            targetUser: email,
            oldValue: "***",
            newValue: "***",
            changedBy: req.user.email,
        });
        res.json({ message: "Password updated" });
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Change role
router.put("/role", auth_1.auth, adminOnly_1.adminOnly, async (req, res) => {
    try {
        const { targetEmail, newRole } = req.body;
        const user = await User_1.User.findOne({ email: targetEmail });
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const oldRole = user.role;
        user.role = newRole;
        await user.save();
        await AuditLog_1.AuditLog.create({
            action: "CHANGE_ROLE",
            targetUser: targetEmail,
            oldValue: oldRole,
            newValue: newRole,
            changedBy: req.user.email,
        });
        res.json({ message: "Role updated" });
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Get all audit logs
router.get("/auditlogs", auth_1.auth, adminOnly_1.adminOnly, async (_, res) => {
    try {
        const logs = await AuditLog_1.AuditLog.find().sort({ date: -1 }); // ترتيب من الأحدث
        res.json(logs);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
exports.default = router;
