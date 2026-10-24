import { Router, RequestHandler } from "express";
import { z } from "zod";
import { Merchant, publicMerchant } from "../models/Merchant";
import { Order, createWithUniqueBarcode } from "../models/Order";
import { requireAuth, adminOnly } from "../middleware/auth";
import { AppError, notFound } from "../lib/errors";
import { ok, created } from "../lib/respond";
import { str, money, idParams } from "../lib/validate";
import { scope } from "../lib/scope";
import { generateApiKey, hashApiKey } from "../lib/apiKeys";
import { recordAudit } from "../services/audit";

const router = Router();

// ---------------- Merchant API-key auth ----------------
export const merchantAuth: RequestHandler = async (req, _res, next) => {
  const apiKey = req.headers["api-key"];
  if (typeof apiKey !== "string" || !apiKey) return next(new AppError(401, "UNAUTHENTICATED", "API key required"));
  const merchant = await Merchant.findOne({ apiKeyHash: hashApiKey(apiKey), apiKeyRevokedAt: null });
  if (!merchant) return next(new AppError(401, "UNAUTHENTICATED", "Invalid API key"));
  req.merchant = merchant;
  next();
};

// ---------------- Admin management ----------------

// Names for dropdowns, any logged-in user.
router.get("/options", requireAuth, async (req, res) => {
  ok(res, await Merchant.find(scope(req)).sort({ name: 1 }).select("name").lean());
});

router.get("/", requireAuth, adminOnly, async (req, res) => {
  const merchants = await Merchant.find(scope(req)).sort({ createdAt: -1 });
  ok(res, merchants.map(publicMerchant));
});

// The new key is returned once and never stored in plain text.
router.post("/", requireAuth, adminOnly, async (req, res) => {
  const { name, withApiKey } = z.object({ name: str.name, withApiKey: z.boolean().default(true) }).strict().parse(req.body);
  const key = withApiKey ? generateApiKey() : null;
  const merchant = await Merchant.create({
    name,
    ...scope(req),
    ...(key && { apiKeyHash: key.hash, apiKeyPrefix: key.prefix, apiKeyCreatedAt: new Date() }),
  });
  await recordAudit(req, { entity: "merchant", entityId: merchant._id, action: "CREATE", label: name });
  created(res, { merchant: publicMerchant(merchant), apiKey: key?.key ?? null });
});

router.patch("/:id", requireAuth, adminOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { name } = z.object({ name: str.name }).strict().parse(req.body);
  const merchant = await Merchant.findOne({ _id: id, ...scope(req) });
  if (!merchant) throw notFound("Merchant");
  const oldName = merchant.name;
  merchant.name = name;
  await merchant.save();
  await recordAudit(req, { entity: "merchant", entityId: merchant._id, action: "RENAME", label: name, changes: { name: { from: oldName, to: name } } });
  ok(res, publicMerchant(merchant));
});

// Rotate: issue a new key (shown once); the old one stops working immediately.
router.post("/:id/api-key", requireAuth, adminOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const key = generateApiKey();
  const merchant = await Merchant.findOneAndUpdate(
    { _id: id, ...scope(req) },
    { $set: { apiKeyHash: key.hash, apiKeyPrefix: key.prefix, apiKeyCreatedAt: new Date() }, $unset: { apiKeyRevokedAt: "" } },
    { returnDocument: "after" }
  );
  if (!merchant) throw notFound("Merchant");
  await recordAudit(req, { entity: "merchant", entityId: merchant._id, action: "ROTATE_API_KEY", label: merchant.name });
  ok(res, { merchant: publicMerchant(merchant), apiKey: key.key });
});

router.delete("/:id/api-key", requireAuth, adminOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const merchant = await Merchant.findOneAndUpdate(
    { _id: id, ...scope(req) },
    { $set: { apiKeyRevokedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!merchant) throw notFound("Merchant");
  await recordAudit(req, { entity: "merchant", entityId: merchant._id, action: "REVOKE_API_KEY", label: merchant.name });
  ok(res, publicMerchant(merchant));
});

// ---------------- Merchant creates an order (API key) ----------------
// `reference` is the merchant's own order id (`barcode` accepted as an alias for older integrations).
// We always generate our own barcode, so a merchant can't probe other merchants' barcodes.
const merchantOrder = z
  .object({
    fullName: str.name,
    phone: str.phone,
    address: str.address,
    cost: money,
    description: str.note.optional(),
    reference: z.string().trim().min(1).max(60).optional(),
    barcode: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

router.post("/order", merchantAuth, async (req, res) => {
  const { reference, barcode, ...data } = merchantOrder.parse(req.body);
  const merchant = req.merchant!;
  const merchantRef = reference ?? barcode;

  if (merchantRef && (await Order.exists({ merchant: merchant._id, merchantRef }))) {
    throw new AppError(409, "DUPLICATE", "You already sent an order with this reference");
  }

  const order = await createWithUniqueBarcode({ ...data, merchant: merchant._id, merchantRef, status: "pending" });
  created(res, { id: order._id, barcode: order.barcode, reference: order.merchantRef ?? null, status: order.status });
});

export default router;
