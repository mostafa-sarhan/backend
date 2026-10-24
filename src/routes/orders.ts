import { Router, Request, Response } from "express";
import { orderModel, createOrderWithBarcode, isDuplicateBarcode, FINAL_STATUSES } from "../models/order";
import { auth } from "../middleware/auth";

const router = Router();
router.use(auth);

const MAX_PAGE_SIZE = 100;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// Builds a Mongo filter from query params:
// search (phone/barcode), status, company, delivery, date (YYYY-MM-DD), from, to, archived (true|false|all; default false)
function buildFilter(q: Request["query"]) {
  const filter: Record<string, any> = {};

  const archived = str(q.archived) ?? "false";
  if (archived !== "all") filter.isArchived = archived === "true";

  for (const key of ["status", "company", "delivery"] as const) {
    const value = str(q[key]);
    if (value) filter[key] = value;
  }

  const search = str(q.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search));
    filter.$or = [{ phone: rx }, { barcode: rx }];
  }

  // `date` matches a single day; `from`/`to` are an inclusive day range.
  const date = str(q.date);
  const from = str(q.from) ?? date;
  const to = str(q.to) ?? date;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00Z`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  return filter;
}

// Keeps `deliveredAt` in sync with the status, so archiving counts from the delivery date.
async function withDeliveredAt(id: string, update: Record<string, any>) {
  if (typeof update.status !== "string") return update;

  if (!FINAL_STATUSES.includes(update.status)) return { ...update, deliveredAt: null };

  const current = await orderModel.findById(id).select("status deliveredAt");
  const alreadyFinal = current && FINAL_STATUSES.includes(current.status) && current.deliveredAt;
  return alreadyFinal ? update : { ...update, deliveredAt: new Date() };
}

// Paginated list: { items, total, page, pages, totalCost }
router.get("/", async (req: Request, res: Response) => {
  try {
    const filter = buildFilter(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), MAX_PAGE_SIZE);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const [items, stats] = await Promise.all([
      orderModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      orderModel.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: 1 }, totalCost: { $sum: "$cost" } } }]),
    ]);

    const total = stats[0]?.total ?? 0;
    res.json({ items, total, page, pages: Math.ceil(total / limit), totalCost: stats[0]?.totalCost ?? 0 });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Full filtered list (no pagination) for reports, printing and Excel export.
router.get("/export", async (req: Request, res: Response) => {
  try {
    res.json(await orderModel.find(buildFilter(req.query)).sort({ createdAt: -1 }));
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Order count per status (all orders, including archived).
router.get("/stats", async (_req, res: Response) => {
  try {
    const rows = await orderModel.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    res.json(Object.fromEntries(rows.map((r) => [r._id, r.count])));
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// Distinct company names, for filter dropdowns.
router.get("/companies", async (req: Request, res: Response) => {
  try {
    const companies = await orderModel.distinct("company", buildFilter(req.query));
    res.json(companies.filter(Boolean).sort());
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/delivery/:deliveryName", async (req: Request, res: Response) => {
  try {
    res.json(await orderModel.find({ delivery: req.params.deliveryName }));
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/barcode/:barcode", async (req: Request, res: Response) => {
  try {
    const order = await orderModel.findOne({ barcode: req.params.barcode });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const order = await orderModel.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const data = { ...req.body };
    if (FINAL_STATUSES.includes(data.status)) data.deliveredAt = new Date();
    res.status(201).json(await createOrderWithBarcode(data));
  } catch (err) {
    if (isDuplicateBarcode(err)) return res.status(409).json({ message: "Barcode already exists" });
    res.status(500).json({ message: "Server error" });
  }
});

// PUT and PATCH both apply a partial update (the frontend only uses PATCH).
const updateOrder = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const update = await withDeliveredAt(id, req.body ?? {});
    const order = await orderModel.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after", runValidators: true });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    if (isDuplicateBarcode(err)) return res.status(409).json({ message: "Barcode already exists" });
    res.status(500).json({ message: "Server error" });
  }
};
router.put("/:id", updateOrder);
router.patch("/:id", updateOrder);

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const order = await orderModel.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order deleted" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
