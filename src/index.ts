import { deliveryModel } from './delivery';
// index.ts
import express, { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// Models
import { User } from "./models/User";
import { orderModel } from "./models/order";
import { merchantModel } from "./models/merchantModel";
import { AuditLog } from "./models/AuditLog";

import { auth } from "./middleware/auth";
import { adminOnly } from "./middleware/adminOnly";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// ---------------- Middleware ----------------
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://sys-shipping-bp0bpp5tc-mostafa-sarhans-projects.vercel.app",
    "https://system-shipping.onrender.com",
    "https://sys-shipping-fq92beg72-mostafa-sarhans-projects.vercel.app",
  ]
}));
app.use(express.json());

// ---------------- Database ----------------
mongoose.connect(process.env.MONGO_URI!).then(async () => {
  const hashed = await bcrypt.hash("123456", 10); // تشفير الباسورد
  await User.updateOne(
    { email: "admin@test.com" },
    { $set: { password: hashed } }
  );
  console.log("Admin password updated to hashed!");
  mongoose.disconnect();
});

// ---------------- AUTH ----------------
app.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ message: "User not found" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ message: "Wrong password" });

  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );

  res.json({
    token,
    user: { email: user.email, role: user.role },
  });
});

// ---------------- USERS ----------------

// Get all users
app.get("/users", auth, adminOnly, async (_, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

// Create user
app.post("/users", auth, adminOnly, async (req: Request, res: Response) => {
  const { email, password, role } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  const newUser = await User.create({ email, password: hashed, role });
  res.status(201).json({ message: "User created", user: { email: newUser.email, role: newUser.role } });
});

// Change password
app.put("/users/password", auth, adminOnly, async (req: Request, res: Response) => {
  const { email, newPassword } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: "User not found" });

  const oldPassword = user.password;
  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  await AuditLog.create({
    action: "CHANGE_PASSWORD",
    targetUser: email,
    oldValue: "***",
    newValue: "***",
    changedBy: req.user.email,
  });

  res.json({ message: "Password updated" });
});

// Change role
app.put("/users/role", auth, adminOnly, async (req: Request, res: Response) => {
  const { targetEmail, newRole } = req.body;

  const user = await User.findOne({ email: targetEmail });
  if (!user) return res.status(404).json({ message: "User not found" });

  const oldRole = user.role;
  user.role = newRole;
  await user.save();

  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  await AuditLog.create({
    action: "CHANGE_ROLE",
    targetUser: targetEmail,
    oldValue: oldRole,
    newValue: newRole,
    changedBy: req.user.email,
  });

  res.json({ message: "Role updated" });
});

// ---------------- AUDIT LOG ----------------
app.get("/audit-logs", auth, adminOnly, async (_, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 });
  res.json(logs);
});

// ---------------- ORDERS ----------------

// Get all orders
app.get("/orders", auth, async (_, res) => {
  const orders = await orderModel.find();
  res.json(orders);
});

// Get order by ID
app.get("/orders/:id", auth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const order = await orderModel.findById(id);
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json(order);
});

// Create order
app.post("/orders", auth, async (req: Request, res: Response) => {
  const order = await orderModel.create(req.body);
  res.status(201).json(order);
});

// Update full order
app.put("/orders/:id", auth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const order = await orderModel.findByIdAndUpdate(id, req.body, { new: true });
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json(order);
});

// Patch order
app.patch("/orders/:id", auth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const order = await orderModel.findByIdAndUpdate(id, { $set: req.body }, { new: true });
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json(order);
});

// Delete order
app.delete("/orders/:id", auth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const order = await orderModel.findByIdAndDelete(id);
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json({ message: "Order deleted" });
});

// Get order by barcode
app.get("/orders/barcode/:barcode", auth, async (req: Request, res: Response) => {
  const { barcode } = req.params;
  const order = await orderModel.findOne({ barcode });
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json(order);
});

// ---------------- DELIVERIES ----------------

// Create delivery
app.post("/deliveries", auth, adminOnly, async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "Delivery name required" });

  const exists = await deliveryModel.findOne({ name });
  if (exists) return res.status(400).json({ message: "Delivery already exists" });

  const delivery = await deliveryModel.create({ name });
  res.status(201).json(delivery);
});

// Get all deliveries
app.get("/deliveries", async (_, res) => {
  const deliveries = await deliveryModel.find().sort({ createdAt: -1 });
  res.json(deliveries);
});

// ---------------- MERCHANTS ----------------

// Merchant auth middleware
export const merchantAuth = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["api-key"] as string | undefined;
  if (!apiKey) return res.status(401).json({ message: "API Key required" });

  const merchant = await merchantModel.findOne({ apiKey });
  if (!merchant) return res.status(403).json({ message: "Invalid API Key" });

  req.merchant = merchant;
  next();
};

// Create merchant
app.post("/merchant", auth, adminOnly, async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "Name is required" });

  const apiKey = crypto.randomBytes(16).toString("hex");
  const merchant = await merchantModel.create({ name, apiKey });
  res.status(201).json(merchant);
});

// Get all merchants
app.get("/merchants", auth, adminOnly, async (_, res) => {
  const merchants = await merchantModel.find().sort({ createdAt: -1 });
  res.json(merchants);
});

// Merchant create order
app.post("/merchant/order", merchantAuth, async (req: Request, res: Response) => {
  const { fullName, phone, address, cost, barcode } = req.body;
  if (!fullName || !phone || !address || !cost || !barcode)
    return res.status(400).json({ message: "Incomplete order data" });

  const merchant = req.merchant!;
  const barcodeExists = await orderModel.findOne({ barcode });
  if (barcodeExists) return res.status(409).json({ message: "Barcode already exists" });

  const order = await orderModel.create({
    fullName, phone, address, cost, barcode,
    company: merchant.name,
    merchant: merchant._id
  });

  res.status(201).json(order);
});

// ---------------- START SERVER ----------------
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
