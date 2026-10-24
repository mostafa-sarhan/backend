import { Router, Request } from "express";
import { z } from "zod";
import { requireAuth, adminOnly } from "../middleware/auth";
import { ok } from "../lib/respond";
import { money, objectId } from "../lib/validate";
import { scope } from "../lib/scope";
import { Fees } from "../lib/money";
import { config } from "../config";
import { listQuerySchema, buildOrderFilter } from "../services/orders";
import { summary, summaryBy, orderIdsFilter } from "../services/reports";

const router = Router();
router.use(requireAuth);

const feeQuery = z.object({ courierFee: money.optional(), companyFee: money.optional() });

// Admins may try other fee values; everyone else gets the configured defaults.
function fees(req: Request, input: z.infer<typeof feeQuery>): Fees {
  const custom = req.user!.role === "admin";
  return {
    courier: custom && input.courierFee !== undefined ? input.courierFee : config.fees.courier,
    company: custom && input.companyFee !== undefined ? input.companyFee : config.fees.company,
  };
}

const reportQuery = listQuerySchema.extend(feeQuery.shape);

function parse(req: Request) {
  const { courierFee, companyFee, ...q } = reportQuery.parse(req.query);
  const f = fees(req, { courierFee, companyFee });
  return { filter: buildOrderFilter(req, q), fees: f };
}

// { total, byStatus, money } for the filtered orders.
router.get("/summary", adminOnly, async (req, res) => {
  const { filter, fees } = parse(req);
  ok(res, await summary(filter, fees), { fees });
});

router.get("/merchants", adminOnly, async (req, res) => {
  const { filter, fees } = parse(req);
  ok(res, await summaryBy("merchant", filter, fees), { fees });
});

router.get("/couriers", adminOnly, async (req, res) => {
  const { filter, fees } = parse(req);
  ok(res, await summaryBy("courier", filter, fees), { fees });
});

// Settlement for a courier's current batch (Couriers page). Open to employees, default fees only.
router.post("/settlement", async (req, res) => {
  const body = z.object({ orderIds: z.array(objectId).min(1).max(500) }).extend(feeQuery.shape).strict().parse(req.body);
  const f = fees(req, body);
  ok(res, await summary({ ...scope(req), ...orderIdsFilter(body.orderIds) }, f), { fees: f });
});

export default router;
