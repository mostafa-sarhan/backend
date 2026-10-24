import { Request } from "express";
import mongoose from "mongoose";
import { Order } from "../models/Order";
import { Fees, summarize } from "../lib/money";

type Filter = Record<string, unknown>;

// Totals by status for the matching orders.
export async function summary(filter: Filter, fees: Fees) {
  const rows = await Order.aggregate([
    { $match: filter },
    { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$cost" } } },
    { $project: { _id: 0, status: "$_id", count: 1, amount: 1 } },
  ]);
  return summarize(rows, fees);
}

// Same, grouped by merchant or courier, with the referenced name.
export async function summaryBy(field: "merchant" | "courier", filter: Filter, fees: Fees) {
  const collection = field === "merchant" ? "merchants" : "deliveries";
  const rows = await Order.aggregate([
    { $match: filter },
    { $group: { _id: { ref: `$${field}`, status: "$status" }, count: { $sum: 1 }, amount: { $sum: "$cost" } } },
    { $group: { _id: "$_id.ref", rows: { $push: { status: "$_id.status", count: "$count", amount: "$amount" } } } },
    { $lookup: { from: collection, localField: "_id", foreignField: "_id", as: "ref" } },
    { $project: { rows: 1, name: { $ifNull: [{ $first: "$ref.name" }, null] } } },
    { $sort: { name: 1 } },
  ]);
  return rows.map((r: { _id: mongoose.Types.ObjectId | null; name: string | null; rows: { status: string; count: number; amount: number }[] }) => ({
    [field]: r._id ? { _id: r._id, name: r.name } : null,
    ...summarize(r.rows, fees),
  }));
}

export const orderIdsFilter = (req: Request, ids: string[]) => ({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } });
