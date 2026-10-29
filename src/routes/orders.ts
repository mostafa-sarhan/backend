import { Router } from "express";
import { z } from "zod";
import { Order } from "../models/Order";
import { AuditEvent } from "../models/AuditEvent";
import { requireAuth, adminOnly } from "../middleware/auth";
import { notFound } from "../lib/errors";
import { ok, created } from "../lib/respond";
import { idParams, pagination, str } from "../lib/validate";
import { scope } from "../lib/scope";
import { config } from "../config";
import {
  listQuerySchema,
  buildOrderFilter,
  populateRefs,
  createOrderSchema,
  updateOrderSchema,
  bulkAssignSchema,
  bulkStatusSchema,
  createOrder,
  updateOrder,
  bulkAssign,
  bulkStatus,
  deleteOrder,
} from "../services/orders";

const router = Router();
router.use(requireAuth);

// Paginated list. meta: { total, page, pages, totalCost }
router.get("/", async (req, res) => {
  const { page, limit, ...q } = listQuerySchema.extend(pagination.shape).parse(req.query);
  const filter = buildOrderFilter(req, q);

  const [items, stats] = await Promise.all([
    populateRefs(req, Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
    Order.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: 1 }, totalCost: { $sum: "$cost" } } }]),
  ]);
  const total = stats[0]?.total ?? 0;
  ok(res, items, { total, page, pages: Math.ceil(total / limit), totalCost: stats[0]?.totalCost ?? 0 });
});

// Admin export (Excel / printing), capped at EXPORT_MAX_ROWS. meta: { total, truncated }
router.get("/export", adminOnly, async (req, res) => {
  const filter = buildOrderFilter(req, listQuerySchema.parse(req.query));
  const [items, total] = await Promise.all([
    populateRefs(req, Order.find(filter).sort({ createdAt: -1 }).limit(config.exportMaxRows)).lean(),
    Order.countDocuments(filter),
  ]);
  ok(res, items, { total, truncated: total > items.length });
});

// { [status]: count } over all orders, archived included.
router.get("/stats", async (req, res) => {
  const rows = await Order.aggregate([{ $match: scope(req) }, { $group: { _id: "$status", count: { $sum: 1 } } }]);
  ok(res, Object.fromEntries(rows.map((r) => [r._id, r.count])));
});

router.post("/bulk/assign", async (req, res) => {
  ok(res, await bulkAssign(req, bulkAssignSchema.parse(req.body)));
});

router.post("/bulk/status", async (req, res) => {
  ok(res, await bulkStatus(req, bulkStatusSchema.parse(req.body)));
});

router.get("/barcode/:barcode", async (req, res) => {
  const { barcode } = z.object({ barcode: str.barcode }).parse(req.params);
  const order = await populateRefs(req, Order.findOne({ barcode, ...scope(req) })).lean();
  if (!order) throw notFound("Order");
  ok(res, order);
});

router.get("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const order = await populateRefs(req, Order.findOne({ _id: id, ...scope(req) })).lean();
  if (!order) throw notFound("Order");
  ok(res, order);
});

// Change history (for the Phase C timeline).
router.get("/:id/history", async (req, res) => {
  const { id } = idParams.parse(req.params);
  if (!(await Order.exists({ _id: id, ...scope(req) }))) throw notFound("Order");
  ok(res, await AuditEvent.find({ ...scope(req), entity: "order", entityId: id }).sort({ createdAt: 1 }).limit(200).lean());
});

router.post("/", async (req, res) => {
  created(res, await createOrder(req, createOrderSchema.parse(req.body)));
});

router.patch("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await updateOrder(req, id, updateOrderSchema.parse(req.body));
  ok(res, await populateRefs(req, Order.findOne({ _id: id, ...scope(req) })).lean());
});

router.delete("/:id", adminOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  await deleteOrder(req, id);
  ok(res, { deleted: true });
});

export default router;
