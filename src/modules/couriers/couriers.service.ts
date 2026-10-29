import { Request } from "express";
import mongoose from "mongoose";
import { Courier } from "./courier.model";
import { User } from "../users/user.model";
import { createUser } from "../users/users.service";
import { recordAudit } from "../audit/audit.service";
import { AppError, notFound } from "../../lib/errors";
import { scope } from "../../lib/scope";
import { withTransaction } from "../../lib/transaction";

// With the email of each courier's login, if any.
export async function listCouriers(req: Request) {
  const couriers = await Courier.find(scope(req)).sort({ name: 1 }).select("name").lean();
  const accounts = await User.find({ ...scope(req), role: "courier", courierId: { $in: couriers.map((c) => c._id) } }).select("email courierId").lean();
  const byCourier = new Map(accounts.map((a) => [String(a.courierId), a.email]));
  return couriers.map((c) => ({ ...c, account: byCourier.get(String(c._id)) ?? null }));
}

export async function createAccount(req: Request, id: string, email: string, password: string) {
  if (!(await Courier.exists({ _id: id, ...scope(req) }))) throw notFound("Courier");
  if (await User.exists({ ...scope(req), courierId: new mongoose.Types.ObjectId(id) })) {
    throw new AppError(409, "DUPLICATE", "This courier already has a login");
  }
  return createUser(req, { email, password, role: "courier" }, { courierId: id });
}

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
