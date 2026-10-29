import { Request, Response, NextFunction } from "express";
import { ok, created } from "../../lib/respond";
import { idParams } from "../../lib/validate";
import { AppError } from "../../lib/errors";
import { createMerchantBody, renameMerchantBody, merchantOrderBody } from "./merchants.schemas";
import * as merchants from "./merchants.service";

// Merchant API-key authentication (header `api-key`).
export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers["api-key"];
  if (typeof apiKey !== "string" || !apiKey || apiKey.length > 200) return next(new AppError(401, "UNAUTHENTICATED", "API key required"));
  const { merchant, tenant } = await merchants.authenticateApiKey(apiKey);
  req.merchant = merchant;
  req.tenant = tenant;
  next();
}

export async function options(req: Request, res: Response) {
  ok(res, await merchants.merchantOptions(req));
}

export async function list(req: Request, res: Response) {
  ok(res, await merchants.listMerchants(req));
}

export async function create(req: Request, res: Response) {
  const { name, withApiKey } = createMerchantBody.parse(req.body);
  created(res, await merchants.createMerchant(req, name, withApiKey));
}

export async function rename(req: Request, res: Response) {
  ok(res, await merchants.renameMerchant(req, idParams.parse(req.params).id, renameMerchantBody.parse(req.body).name));
}

export async function rotateKey(req: Request, res: Response) {
  ok(res, await merchants.rotateApiKey(req, idParams.parse(req.params).id));
}

export async function revokeKey(req: Request, res: Response) {
  ok(res, await merchants.revokeApiKey(req, idParams.parse(req.params).id));
}

export async function createOrder(req: Request, res: Response) {
  created(res, await merchants.createMerchantOrder(req, merchantOrderBody.parse(req.body)));
}
