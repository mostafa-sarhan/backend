import { Router } from "express";
import { z } from "zod";
import { Courier } from "../models/Courier";
import { requireAuth, adminOnly } from "../middleware/auth";
import { notFound } from "../lib/errors";
import { ok, created } from "../lib/respond";
import { idParams, str } from "../lib/validate";
import { scope } from "../lib/scope";
import { recordAudit } from "../services/audit";

const router = Router();
router.use(requireAuth);

const body = z.object({ name: str.name }).strict();

router.get("/", async (req, res) => {
  ok(res, await Courier.find(scope(req)).sort({ name: 1 }).select("name").lean());
});

router.post("/", adminOnly, async (req, res) => {
  const courier = await Courier.create({ ...body.parse(req.body), ...scope(req) });
  await recordAudit(req, { entity: "courier", entityId: courier._id, action: "CREATE", label: courier.name });
  created(res, courier);
});

// Renaming is safe now: orders reference couriers by id.
router.patch("/:id", adminOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { name } = body.parse(req.body);
  const before = await Courier.findOneAndUpdate({ _id: id, ...scope(req) }, { name }, { runValidators: true });
  if (!before) throw notFound("Courier");
  await recordAudit(req, { entity: "courier", entityId: before._id, action: "RENAME", label: name, changes: { name: { from: before.name, to: name } } });
  ok(res, { _id: before._id, name });
});

export default router;
