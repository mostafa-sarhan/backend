import { Request } from "express";
import { Courier } from "./courier.model";
import { recordAudit } from "../audit/audit.service";
import { notFound } from "../../lib/errors";
import { scope } from "../../lib/scope";
import { withTransaction } from "../../lib/transaction";

export const listCouriers = (req: Request) => Courier.find(scope(req)).sort({ name: 1 }).select("name").lean();

export const createCourier = (req: Request, name: string) =>
  withTransaction(async () => {
    const [courier] = await Courier.create([{ ...scope(req), name }]);
    await recordAudit(req, { entity: "courier", entityId: courier._id, action: "CREATE", label: courier.name });
    return courier;
  });

// Renaming is safe: orders reference couriers by id.
export const renameCourier = (req: Request, id: string, name: string) =>
  withTransaction(async () => {
    const before = await Courier.findOneAndUpdate({ _id: id, ...scope(req) }, { name }, { runValidators: true });
    if (!before) throw notFound("Courier");
    await recordAudit(req, { entity: "courier", entityId: before._id, action: "RENAME", label: name, changes: { name: { from: before.name, to: name } } });
    return { _id: before._id, name };
  });
