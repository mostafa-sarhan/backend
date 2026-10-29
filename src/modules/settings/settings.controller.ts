import { Request, Response } from "express";
import { ok } from "../../lib/respond";
import { updateSettingsBody } from "./settings.schemas";
import * as settings from "./settings.service";

export function get(req: Request, res: Response) {
  ok(res, settings.getSettings(req));
}

export async function update(req: Request, res: Response) {
  ok(res, await settings.updateSettings(req, updateSettingsBody.parse(req.body)));
}
