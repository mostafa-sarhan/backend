import { Request } from "express";
import { z } from "zod";
import { Merchant, publicMerchant } from "./merchant.model";
import { Order, createWithUniqueBarcode } from "../orders/order.model";
import { recordAudit } from "../audit/audit.service";
import { loadUsableTenant, assertOrderQuota } from "../tenants/tenants.service";
import { generateApiKey, hashApiKey } from "./apiKeys";
import { AppError, notFound } from "../../lib/errors";
import { scope } from "../../lib/scope";
import { UNSCOPED } from "../../lib/tenantPlugin";
import { withTransaction } from "../../lib/transaction";
import { merchantOrderBody } from "./merchants.schemas";

// The key identifies merchant and tenant (keys are globally unique hashes). A suspended or
// expired tenant blocks its merchants' keys too.
export async function authenticateApiKey(apiKey: string) {
  const merchant = await Merchant.findOne({ apiKeyHash: hashApiKey(apiKey), apiKeyRevokedAt: null }).setOptions(UNSCOPED);
  if (!merchant) throw new AppError(401, "UNAUTHENTICATED", "Invalid API key");
  return { merchant, tenant: await loadUsableTenant(merchant.tenantId) };
}

export const merchantOptions = (req: Request) => Merchant.find(scope(req)).sort({ name: 1 }).select("name").lean();

export async function listMerchants(req: Request) {
  return (await Merchant.find(scope(req)).sort({ createdAt: -1 })).map(publicMerchant);
}

// The new key is returned once and never stored in plain text.
export async function createMerchant(req: Request, name: string, withApiKey: boolean) {
  const key = withApiKey ? generateApiKey() : null;
  return withTransaction(async () => {
    const [merchant] = await Merchant.create([
      { name, ...scope(req), ...(key && { apiKeyHash: key.hash, apiKeyPrefix: key.prefix, apiKeyCreatedAt: new Date() }) },
    ]);
    await recordAudit(req, { entity: "merchant", entityId: merchant._id, action: "CREATE", label: name });
    return { merchant: publicMerchant(merchant), apiKey: key?.key ?? null };
  });
}

export const renameMerchant = (req: Request, id: string, name: string) =>
  withTransaction(async () => {
    const merchant = await Merchant.findOne({ _id: id, ...scope(req) });
    if (!merchant) throw notFound("Merchant");
    const oldName = merchant.name;
    merchant.name = name;
    await merchant.save();
    await recordAudit(req, { entity: "merchant", entityId: merchant._id, action: "RENAME", label: name, changes: { name: { from: oldName, to: name } } });
    return publicMerchant(merchant);
  });

// Rotate: a new key (shown once); the old one stops working immediately.
export async function rotateApiKey(req: Request, id: string) {
  const key = generateApiKey();
  return withTransaction(async () => {
    const merchant = await Merchant.findOneAndUpdate(
      { _id: id, ...scope(req) },
      { $set: { apiKeyHash: key.hash, apiKeyPrefix: key.prefix, apiKeyCreatedAt: new Date() }, $unset: { apiKeyRevokedAt: "" } },
      { returnDocument: "after" }
    );
    if (!merchant) throw notFound("Merchant");
    await recordAudit(req, { entity: "merchant", entityId: merchant._id, action: "ROTATE_API_KEY", label: merchant.name });
    return { merchant: publicMerchant(merchant), apiKey: key.key };
  });
}

export const revokeApiKey = (req: Request, id: string) =>
  withTransaction(async () => {
    const merchant = await Merchant.findOneAndUpdate({ _id: id, ...scope(req) }, { $set: { apiKeyRevokedAt: new Date() } }, { returnDocument: "after" });
    if (!merchant) throw notFound("Merchant");
    await recordAudit(req, { entity: "merchant", entityId: merchant._id, action: "REVOKE_API_KEY", label: merchant.name });
    return publicMerchant(merchant);
  });

// Order from the merchant API. We always generate our own barcode, so a merchant can't probe
// barcodes; their reference is unique per merchant.
export async function createMerchantOrder(req: Request, input: z.infer<typeof merchantOrderBody>) {
  const { reference, barcode, ...data } = input;
  const merchant = req.merchant!;
  const merchantRef = reference ?? barcode;

  if (merchantRef && (await Order.exists({ ...scope(req), merchant: merchant._id, merchantRef }))) {
    throw new AppError(409, "DUPLICATE", "You already sent an order with this reference");
  }
  await assertOrderQuota(req.tenant!);

  const order = await createWithUniqueBarcode({ ...data, ...scope(req), merchant: merchant._id, merchantRef, status: "pending" });
  return { id: order._id, barcode: order.barcode, reference: order.merchantRef ?? null, status: order.status };
}
