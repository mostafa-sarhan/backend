import { Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Order, OrderDoc, createWithUniqueBarcode } from "../models/Order";
import { Courier } from "../models/Courier";
import { Merchant } from "../models/Merchant";
import { AuditEvent } from "../models/AuditEvent";
import { ORDER_STATUSES, OrderStatus, canTransition, isFinal, allowedTransitions } from "../domain/orderStatus";
import { forbiddenFields } from "../domain/permissions";
import { AppError, forbidden, notFound } from "../lib/errors";
import { scope } from "../lib/scope";
import { objectId, str, money, day } from "../lib/validate";
import { auditEvent, diff, recordAudit } from "./audit";

// ---------- Input schemas (strict: unknown fields are rejected) ----------
const orderFields = {
  fullName: str.name,
  phone: str.phone,
  address: str.address,
  cost: money,
  description: str.note,
  merchant: objectId,
  courier: objectId.nullable(),
  status: z.enum(ORDER_STATUSES),
};

export const createOrderSchema = z
  .object({
    fullName: orderFields.fullName,
    phone: orderFields.phone,
    address: orderFields.address,
    cost: orderFields.cost,
    description: orderFields.description.optional(),
    merchant: orderFields.merchant,
    courier: objectId.optional(),
  })
  .strict();

export const updateOrderSchema = z.object(orderFields).partial().strict();
export type OrderUpdate = z.infer<typeof updateOrderSchema>;

export const listQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9+-]*$/, "Digits or barcode characters only")
    .optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  merchant: objectId.optional(),
  courier: objectId.optional(),
  date: day.optional(),
  from: day.optional(),
  to: day.optional(),
  archived: z.enum(["true", "false", "all"]).default("false"),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Mongo filter for list/export/report queries. Days are UTC.
export function buildOrderFilter(req: Request, q: ListQuery) {
  const filter: Record<string, unknown> = { ...scope(req) };
  if (q.archived !== "all") filter.isArchived = q.archived === "true";
  if (q.status) filter.status = q.status;
  if (q.merchant) filter.merchant = new mongoose.Types.ObjectId(q.merchant);
  if (q.courier) filter.courier = new mongoose.Types.ObjectId(q.courier);
  if (q.search) {
    // Prefix match so the phone / barcode indexes are used.
    const rx = new RegExp(`^${escapeRegex(q.search)}`);
    filter.$or = [{ phone: rx }, { barcode: rx }];
  }
  const from = q.from ?? q.date;
  const to = q.to ?? q.date;
  if (from || to) {
    filter.createdAt = {
      ...(from && { $gte: new Date(`${from}T00:00:00Z`) }),
      ...(to && { $lte: new Date(`${to}T23:59:59.999Z`) }),
    };
  }
  return filter;
}

export const populateRefs = <T>(query: mongoose.Query<T, unknown>) =>
  query.populate("courier", "name").populate("merchant", "name");

async function assertExists(model: typeof Courier | typeof Merchant, id: string | null | undefined, what: string) {
  if (id && !(await model.exists({ _id: id, ...scope() }))) {
    throw new AppError(400, "VALIDATION_ERROR", `${what} does not exist`, [{ path: what.toLowerCase(), message: "Not found" }]);
  }
}

// ---------- Create ----------
export async function createOrder(req: Request, input: z.infer<typeof createOrderSchema>) {
  await Promise.all([assertExists(Merchant, input.merchant, "Merchant"), assertExists(Courier, input.courier, "Courier")]);

  const order = await createWithUniqueBarcode({
    ...input,
    ...scope(req),
    status: input.courier ? "with_courier" : "pending",
  });
  await recordAudit(req, { entity: "order", entityId: order._id, action: "CREATE", label: order.barcode, changes: { status: { from: null, to: order.status } } });
  return order;
}

// ---------- Update ----------
// Validates the change against role permissions and the status state machine, and returns
// the $set to apply. Throws on any violation.
export async function planUpdate(req: Request, order: OrderDoc, input: OrderUpdate) {
  const role = req.user!.role;

  const denied = forbiddenFields(role, Object.keys(input));
  if (denied.length) throw new AppError(403, "FORBIDDEN_FIELDS", "You can't change these fields", denied);
  if (order.isArchived && role !== "admin") throw forbidden("Archived orders can only be changed by an admin");

  await Promise.all([assertExists(Merchant, input.merchant, "Merchant"), assertExists(Courier, input.courier, "Courier")]);

  const set: Record<string, unknown> = { ...input };
  const from = order.status as OrderStatus;
  const to = input.status;

  if (to && to !== from) {
    if (!canTransition(from, to, role)) {
      throw new AppError(409, "INVALID_STATUS_TRANSITION", `Can't change status from ${from} to ${to}`, {
        from,
        to,
        allowed: allowedTransitions(from, role),
      });
    }
    const courier = input.courier !== undefined ? input.courier : order.courier;
    if (to === "with_courier" && !courier) {
      throw new AppError(400, "VALIDATION_ERROR", "A courier is required", [{ path: "courier", message: "Required" }]);
    }
    if (to === "pending") set.courier = null; // back to the warehouse, unassigned
    if (isFinal(to)) set.deliveredAt = new Date();
    if (isFinal(from) && !isFinal(to)) {
      set.deliveredAt = null;
      set.isArchived = false;
    }
  } else {
    delete set.status;
  }
  return set;
}

const conflict = () => new AppError(409, "CONFLICT", "The order was changed by someone else, reload and try again");

export async function updateOrder(req: Request, id: string, input: OrderUpdate) {
  const order = await Order.findOne({ _id: id, ...scope(req) });
  if (!order) throw notFound("Order");

  const set = await planUpdate(req, order, input);
  if (!Object.keys(set).length) return order;

  // Optimistic concurrency: only apply if nobody changed the order since we read it.
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, updatedAt: order.updatedAt },
    { $set: set },
    { returnDocument: "after", runValidators: true }
  );
  if (!updated) throw conflict();

  const changes = diff(order.toObject(), set);
  await recordAudit(req, { entity: "order", entityId: order._id, action: changes.status ? "STATUS_CHANGE" : "UPDATE", label: order.barcode, changes });
  return updated;
}

// ---------- Bulk ----------
// All-or-nothing validation, then a single bulkWrite. Each write is guarded by updatedAt, so
// concurrent edits are reported as conflicts instead of overwritten.
async function applyBulk(req: Request, orders: OrderDoc[], plans: Record<string, unknown>[]) {
  const result = await Order.bulkWrite(
    orders.map((order, i) => ({
      updateOne: { filter: { _id: order._id, updatedAt: order.updatedAt }, update: { $set: plans[i] } },
    }))
  );
  await AuditEvent.insertMany(
    orders.map((order, i) => {
      const changes = diff(order.toObject(), plans[i]);
      return auditEvent(req, { entity: "order", entityId: order._id, action: changes.status ? "STATUS_CHANGE" : "UPDATE", label: order.barcode, changes });
    })
  );
  return { requested: orders.length, updated: result.modifiedCount, conflicts: orders.length - result.matchedCount };
}

async function loadAll(req: Request, ids: string[]) {
  const orders = await Order.find({ _id: { $in: ids }, ...scope(req) });
  const byId = new Map(orders.map((o) => [o._id.toString(), o]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new AppError(404, "NOT_FOUND", "Some orders were not found", { missing });
  return ids.map((id) => byId.get(id)!);
}

async function planAll(req: Request, orders: OrderDoc[], inputs: OrderUpdate[]) {
  const plans: Record<string, unknown>[] = [];
  const problems: { id: string; barcode: string; code: string; message: string }[] = [];
  for (const [i, order] of orders.entries()) {
    try {
      plans.push(await planUpdate(req, order, inputs[i]));
    } catch (err) {
      const e = err as AppError;
      problems.push({ id: order._id.toString(), barcode: order.barcode, code: e.code ?? "INTERNAL_ERROR", message: e.message });
    }
  }
  if (problems.length) throw new AppError(409, "INVALID_STATUS_TRANSITION", "Some orders can't be changed; nothing was saved", problems);
  return plans;
}

export const bulkAssignSchema = z.object({ orderIds: z.array(objectId).min(1).max(500), courier: objectId }).strict();

// Hand pending orders to a courier.
export async function bulkAssign(req: Request, input: z.infer<typeof bulkAssignSchema>) {
  const ids = [...new Set(input.orderIds)];
  const orders = await loadAll(req, ids);
  const plans = await planAll(req, orders, orders.map(() => ({ courier: input.courier, status: "with_courier" as const })));
  return applyBulk(req, orders, plans);
}

export const bulkStatusSchema = z
  .object({
    updates: z
      .array(z.object({ id: objectId, status: z.enum(ORDER_STATUSES) }).strict())
      .min(1)
      .max(500),
  })
  .strict();

export async function bulkStatus(req: Request, input: z.infer<typeof bulkStatusSchema>) {
  const updates = [...new Map(input.updates.map((u) => [u.id, u])).values()];
  const orders = await loadAll(req, updates.map((u) => u.id));
  const plans = await planAll(req, orders, updates.map((u) => ({ status: u.status })));
  return applyBulk(req, orders, plans);
}

// ---------- Delete ----------
export async function deleteOrder(req: Request, id: string) {
  const order = await Order.findOneAndDelete({ _id: id, ...scope(req) });
  if (!order) throw notFound("Order");
  await recordAudit(req, {
    entity: "order",
    entityId: order._id,
    action: "DELETE",
    label: order.barcode,
    changes: { order: { from: order.toObject(), to: null } },
  });
}
