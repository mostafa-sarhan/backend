import { Request, Response } from "express";
import { ok, created } from "../../lib/respond";
import { importQuery } from "./import.schemas";
import * as imports from "./import.service";

// POST /orders/import?mode=dry-run|commit  (multipart, field "file")
export async function importOrders(req: Request, res: Response) {
  const { mode } = importQuery.parse(req.query);
  if (mode === "commit") created(res, await imports.commit(req, req.file!.buffer));
  else ok(res, await imports.dryRun(req, req.file!.buffer));
}

export async function template(_req: Request, res: Response) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="orders-template.xlsx"');
  res.send(await imports.template());
}
