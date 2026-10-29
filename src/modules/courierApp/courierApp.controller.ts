import { Request, Response } from "express";
import { ok } from "../../lib/respond";
import { idParams } from "../../lib/validate";
import { outcomeBody } from "./courierApp.schemas";
import * as courier from "./courierApp.service";

export async function orders(req: Request, res: Response) {
  ok(res, await courier.openOrders(req));
}

export async function today(req: Request, res: Response) {
  ok(res, await courier.today(req));
}

export async function outcome(req: Request, res: Response) {
  const { status, reason } = outcomeBody.parse(req.body);
  ok(res, await courier.reportOutcome(req, idParams.parse(req.params).id, status, reason));
}
