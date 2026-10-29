import { Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Order } from "../orders/order.model";
import { Merchant, publicMerchant } from "../merchants/merchant.model";
import { createOrder, listOrders } from "../orders/orders.service";
import { rotateApiKey } from "../merchants/merchants.service";
import { summaryReport } from "../reports/reports.service";
import { tenantSettings } from "../tenants/tenants.service";
import { notFound } from "../../lib/errors";
import { scope } from "../../lib/scope";
import { portalOrderBody } from "./merchantPortal.schemas";

const merchantId = (req: Request) => new mongoose.Types.ObjectId(req.user!.merchantId);
const mine = (req: Request) => ({ merchant: merchantId(req) });

// What a merchant may see about its orders (no courier details, fees or audit data).
const FIELDS = "barcode trackingId merchantRef fullName phone address cost description status reason deliveredAt createdAt updatedAt";

export async function listOwnOrders(req: Request, q: Parameters<typeof listOrders>[1], page: number, limit: number) {
  const { items, meta } = await listOrders(req, q, page, limit, mine(req));
  const pick = FIELDS.split(" ");
  return { items: items.map((o) => Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k]) => k === "_id" || pick.includes(k)))), meta };
}

export async function getOwnOrder(req: Request, id: string) {
  const order = await Order.findOne({ _id: id, ...scope(req), ...mine(req) }).select(`${FIELDS} statusHistory.status statusHistory.at statusHistory.reason`).lean();
  if (!order) throw notFound("Order");
  return order;
}

export const createOwnOrder = (req: Request, input: z.infer<typeof portalOrderBody>) =>
  createOrder(req, { ...input, merchant: req.user!.merchantId! });

// The merchant's statement, using the tenant's deduction rules. Commissions the merchant
// doesn't pay (e.g. the courier fee by default) are not shown.
export async function statement(req: Request, from?: string, to?: string) {
  const { data } = await summaryReport(req, { archived: "all", merchant: req.user!.merchantId, from, to }, {});
  const { merchantDeductions: deductions } = tenantSettings(req.tenant!);
  const { money } = data;
  return {
    total: data.total,
    byStatus: data.byStatus,
    money: {
      deliveredCount: money.deliveredCount,
      deliveredTotal: money.deliveredTotal,
      deductions: {
        ...(deductions.includes("company") && { company: money.companyCommission }),
        ...(deductions.includes("courier") && { courier: money.courierCommission }),
      },
      merchantNet: money.merchantNet,
    },
  };
}

export async function apiKeyInfo(req: Request) {
  const merchant = await Merchant.findOne({ _id: merchantId(req), ...scope(req) });
  if (!merchant) throw notFound("Merchant");
  const m = publicMerchant(merchant);
  return { name: m.name, apiKeyPrefix: m.apiKeyPrefix, hasActiveKey: m.hasActiveKey, apiKeyCreatedAt: m.apiKeyCreatedAt };
}

export const rotateOwnApiKey = async (req: Request) => {
  const { apiKey, merchant } = await rotateApiKey(req, req.user!.merchantId!);
  return { apiKey, apiKeyPrefix: merchant.apiKeyPrefix };
};

