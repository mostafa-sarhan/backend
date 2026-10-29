import { Request } from "express";
import mongoose from "mongoose";
import { Order } from "../orders/order.model";
import { buildOrderFilter } from "../orders/orders.service";
import { ListQuery } from "../orders/orders.schemas";
import { ADMIN_ROLES } from "../users/user.model";
import { Fees, summarize } from "./money";
import { scope } from "../../lib/scope";
import { config } from "../../config";

type Filter = Record<string, unknown>;
type Overrides = { courierFee?: number; companyFee?: number };

// Admins may try other fee values; everyone else gets the configured defaults.
function resolveFees(req: Request, o: Overrides): Fees {
  const custom = ADMIN_ROLES.includes(req.user!.role);
  return {
    courier: custom && o.courierFee !== undefined ? o.courierFee : config.fees.courier,
    company: custom && o.companyFee !== undefined ? o.companyFee : config.fees.company,
  };
}

async function totalsByStatus(filter: Filter, fees: Fees) {
  const rows = await Order.aggregate([
    { $match: filter },
    { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$cost" } } },
    { $project: { _id: 0, status: "$_id", count: 1, amount: 1 } },
  ]);
  return summarize(rows, fees);
}

export async function summaryReport(req: Request, q: ListQuery, o: Overrides) {
  const fees = resolveFees(req, o);
  return { data: await totalsByStatus(buildOrderFilter(req, q), fees), fees };
}

// Totals grouped by merchant or courier, with the referenced name.
export async function groupedReport(req: Request, field: "merchant" | "courier", q: ListQuery, o: Overrides) {
  const fees = resolveFees(req, o);
  const collection = field === "merchant" ? "merchants" : "deliveries";
  const rows = await Order.aggregate([
    { $match: buildOrderFilter(req, q) },
    { $group: { _id: { ref: `$${field}`, status: "$status" }, count: { $sum: 1 }, amount: { $sum: "$cost" } } },
    { $group: { _id: "$_id.ref", rows: { $push: { status: "$_id.status", count: "$count", amount: "$amount" } } } },
    { $lookup: { from: collection, localField: "_id", foreignField: "_id", as: "ref" } },
    { $project: { rows: 1, name: { $ifNull: [{ $first: "$ref.name" }, null] } } },
    { $sort: { name: 1 } },
  ]);
  const data = rows.map((r: { _id: mongoose.Types.ObjectId | null; name: string | null; rows: { status: string; count: number; amount: number }[] }) => ({
    [field]: r._id ? { _id: r._id, name: r.name } : null,
    ...summarize(r.rows, fees),
  }));
  return { data, fees };
}

export async function settlement(req: Request, orderIds: string[], o: Overrides) {
  const fees = resolveFees(req, o);
  const filter = { ...scope(req), _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) } };
  return { data: await totalsByStatus(filter, fees), fees };
}
