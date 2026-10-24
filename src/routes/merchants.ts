import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Merchant } from "../models/Merchant";
import { Order } from "../models/Order";
import { requireAuth, adminOnly } from "../middleware/auth";
import { AppError } from "../lib/errors";
import { ok, created } from "../lib/respond";
import { str, money } from "../lib/validate";
import { scope } from "../lib/scope";

const router = Router();

// ---------------- Merchant API-key auth ----------------
export const merchantAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const apiKey = req.headers["api-key"];
  if (typeof apiKey !== "string" || !apiKey) return next(new AppError(401, "UNAUTHENTICATED", "API key required"));
  const merchant = await Merchant.findOne({ apiKey });
  if (!merchant) return next(new AppError(401, "UNAUTHENTICATED", "Invalid API key"));
  req.merchant = merchant;
  next();
};

// Names for dropdowns, any logged-in user.
router.get("/options", requireAuth, async (req, res) => {
  ok(res, await Merchant.find(scope(req)).sort({ name: 1 }).select("name").lean());
});

router.get("/", requireAuth, adminOnly, async (req, res) => {
  ok(res, await Merchant.find(scope(req)).sort({ createdAt: -1 }).lean());
});

router.post("/", requireAuth, adminOnly, async (req, res) => {
  const { name } = z.object({ name: str.name }).strict().parse(req.body);
  const merchant = await Merchant.create({ name, apiKey: crypto.randomBytes(16).toString("hex"), ...scope(req) });
  created(res, merchant);
});

// ---------------- Merchant creates an order ----------------
const merchantOrder = z.object({
  fullName: str.name,
  phone: str.phone,
  address: str.address,
  cost: money,
  barcode: str.barcode,
  description: str.note.optional(),
});

router.post("/order", merchantAuth, async (req, res) => {
  const { barcode, ...data } = merchantOrder.parse(req.body);
  if (await Order.exists({ barcode })) throw new AppError(409, "DUPLICATE", "Barcode already exists");
  const order = await Order.create({ ...data, barcode, merchant: req.merchant!._id });
  created(res, order);
});

export default router;
