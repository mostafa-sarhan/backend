import { Request } from "express";
import mongoose from "mongoose";
import { Order } from "../orders/order.model";
import { updateOrder } from "../orders/orders.service";
import { tenantSettings } from "../tenants/tenants.service";
import { scope } from "../../lib/scope";
import { dayStart, localDay } from "../../lib/time";

// Everything a courier sees is limited to orders assigned to them.
const mine = (req: Request) => ({ ...scope(req), courier: new mongoose.Types.ObjectId(req.user!.courierId) });

// Only what's needed on the road (no merchant, fees or audit data).
const FIELDS = "barcode fullName phone address cost description status reason deliveredAt createdAt";

export const openOrders = (req: Request) => Order.find({ ...mine(req), status: "with_courier" }).sort({ createdAt: 1 }).select(FIELDS).limit(300).lean();

// Today's results (tenant timezone): cash collected from delivered orders and counts per outcome.
export async function today(req: Request) {
  const { timezone } = tenantSettings(req.tenant!);
  const since = dayStart(localDay(new Date(), timezone), timezone);
  const [closed, open] = await Promise.all([
    Order.aggregate([
      { $match: { ...mine(req), deliveredAt: { $gte: since } } },
      { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$cost" } } },
    ]),
    Order.countDocuments({ ...mine(req), status: "with_courier" }),
  ]);
  const by = Object.fromEntries(closed.map((r) => [r._id, { count: r.count, amount: r.amount }]));
  return {
    open,
    delivered: by.delivered?.count ?? 0,
    returned: by.returned?.count ?? 0,
    refused: by.refused?.count ?? 0,
    cashToHandOver: by.delivered?.amount ?? 0,
  };
}

// Goes through the normal order service: state machine, permissions, fee snapshot, audit.
export async function reportOutcome(req: Request, id: string, status: "delivered" | "returned" | "refused" | "exchanged", reason?: string) {
  const updated = await updateOrder(req, id, { status, ...(reason !== undefined && { reason }) }, { courier: new mongoose.Types.ObjectId(req.user!.courierId) });
  return Order.findOne({ _id: updated._id, ...scope(req) }).select(FIELDS).lean();
}
