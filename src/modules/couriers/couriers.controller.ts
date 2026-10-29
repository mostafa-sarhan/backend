import { Request, Response } from "express";
import { ok, created } from "../../lib/respond";
import { idParams } from "../../lib/validate";
import { courierBody, accountBody } from "./couriers.schemas";
import * as couriers from "./couriers.service";

export async function list(req: Request, res: Response) {
  ok(res, await couriers.listCouriers(req));
}

export async function create(req: Request, res: Response) {
  created(res, await couriers.createCourier(req, courierBody.parse(req.body).name));
}

export async function createAccount(req: Request, res: Response) {
  const { email, password } = accountBody.parse(req.body);
  created(res, await couriers.createAccount(req, idParams.parse(req.params).id, email, password));
}

export async function rename(req: Request, res: Response) {
  ok(res, await couriers.renameCourier(req, idParams.parse(req.params).id, courierBody.parse(req.body).name));
}
