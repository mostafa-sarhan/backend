import { Request } from "express";
import mongoose from "mongoose";
import { Order } from "../orders/order.model";
import { buildOrderFilter } from "../orders/orders.service";
import { ListQuery } from "../orders/orders.schemas";
import { ADMIN_ROLES } from "../users/user.model";
import { tenantSettings } from "../tenants/tenants.service";
import { summarize, FeeOverrides, StatusRow } from "./money";
import { scope } from "../../lib/scope";

type Filter = Record<string, unknown>;

// What-if fees are for admins only; everyone else sees the stored snapshots.
function context(req: Request, o: FeeOverrides) {
  const settings = tenantSettings(req.tenant!);
  const overrides = ADMIN_ROLES.includes(req.user!.role) ? o : {};
  // `fees` in meta: the current settings, with any what-if values applied.
  const fees = { courier: overrides.courierFee ?? settings.fees.courier, company: overrides.companyFee ?? settings.fees.company };
  return { overrides, fees, deductions: settings.merchantDeductions };
}

// Sums cost and the fee snapshots per status. Delivered orders without a snapshot (shouldn't
// happen after the migration) fall back to the tenant's current fees.
function statusGroupStages(req: Request) {
  const { fees } = tenantSettings(req.tenant!);
  return {
    count: { $sum: 1 },
    amount: { $sum: "$cost" },
    courierFees: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, { $ifNull: ["$fees.courier", fees.courier] }, 0] } },
    companyFees: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, { $ifNull: ["$fees.company", fees.company] }, 0] } },
  };
}

async function totalsByStatus(req: Request, filter: Filter) {
  return Order.aggregate<StatusRow>([
    { $match: filter },
    { $group: { _id: "$status", ...statusGroupStages(req) } },
    { $project: { _id: 0, status: "$_id", count: 1, amount: 1, courierFees: 1, companyFees: 1 } },
  ]);
}

export async function summaryReport(req: Request, q: ListQuery, o: FeeOverrides) {
  const { overrides, fees, deductions } = context(req, o);
  return { data: summarize(await totalsByStatus(req, buildOrderFilter(req, q)), deductions, overrides), fees };
}

// Totals grouped by merchant or courier, with the referenced name.
export async function groupedReport(req: Request, field: "merchant" | "courier", q: ListQuery, o: FeeOverrides) {
  const { overrides, fees, deductions } = context(req, o);
  const collection = field === "merchant" ? "merchants" : "deliveries";
  const rows = await Order.aggregate([
    { $match: buildOrderFilter(req, q) },
    { $group: { _id: { ref: `$${field}`, status: "$status" }, ...statusGroupStages(req) } },
    {
      $group: {
        _id: "$_id.ref",
        rows: { $push: { status: "$_id.status", count: "$count", amount: "$amount", courierFees: "$courierFees", companyFees: "$companyFees" } },
      },
    },
    { $lookup: { from: collection, localField: "_id", foreignField: "_id", as: "ref" } },
    { $project: { rows: 1, name: { $ifNull: [{ $first: "$ref.name" }, null] } } },
    { $sort: { name: 1 } },
  ]);
  const data = rows.map((r: { _id: mongoose.Types.ObjectId | null; name: string | null; rows: StatusRow[] }) => ({
    [field]: r._id ? { _id: r._id, name: r.name } : null,
    ...summarize(r.rows, deductions, overrides),
  }));
  return { data, fees };
}

export async function settlement(req: Request, orderIds: string[], o: FeeOverrides) {
  const { overrides, fees, deductions } = context(req, o);
  const filter = { ...scope(req), _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) } };
  return { data: summarize(await totalsByStatus(req, filter), deductions, overrides), fees };
}
