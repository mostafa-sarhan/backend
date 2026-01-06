import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { merchantModel } from "../models/merchantModel";
import { orderModel } from "../models/order";
import { auth } from "../middleware/auth";
import { adminOnly } from "../middleware/adminOnly";

const router = Router();

// ---------------- Merchant Auth Middleware ----------------
export const merchantAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.headers["api-key"] as string | undefined;
    if (!apiKey) return res.status(401).json({ message: "API Key required" });

    const merchant = await merchantModel.findOne({ apiKey });
    if (!merchant) return res.status(403).json({ message: "Invalid API Key" });

    req.merchant = merchant;
    next();
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------- MERCHANTS ----------------

// Create merchant
router.post("/", auth, adminOnly, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });

    const apiKey = crypto.randomBytes(16).toString("hex");
    const merchant = await merchantModel.create({ name, apiKey });
    res.status(201).json(merchant);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get all merchants
router.get("/", auth, adminOnly, async (_, res: Response) => {
  try {
    const merchants = await merchantModel.find().sort({ createdAt: -1 });
    res.json(merchants);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- MERCHANT CREATE ORDER ----------------

router.post("/order", merchantAuth, async (req: Request, res: Response) => {
  try {
    const { fullName, phone, address, cost, barcode } = req.body;
    if (!fullName || !phone || !address || !cost || !barcode)
      return res.status(400).json({ message: "Incomplete order data" });

    const merchant = req.merchant!;
    const barcodeExists = await orderModel.findOne({ barcode });
    if (barcodeExists) return res.status(409).json({ message: "Barcode already exists" });

    const order = await orderModel.create({
      fullName,
      phone,
      address,
      cost,
      barcode,
      company: merchant.name,
      merchant: merchant._id,
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
