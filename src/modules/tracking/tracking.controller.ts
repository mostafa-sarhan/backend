import { Request, Response } from "express";
import { ok } from "../../lib/respond";
import { trackingParams } from "./tracking.schemas";
import * as tracking from "./tracking.service";

export async function get(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  ok(res, await tracking.track(trackingParams.parse(req.params).trackingId));
}
