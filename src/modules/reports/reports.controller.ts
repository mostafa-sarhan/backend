import { Request, Response } from "express";
import { ok } from "../../lib/respond";
import { reportQuery, settlementBody } from "./reports.schemas";
import * as reports from "./reports.service";

export async function summary(req: Request, res: Response) {
  const { courierFee, companyFee, ...q } = reportQuery.parse(req.query);
  const { data, fees } = await reports.summaryReport(req, q, { courierFee, companyFee });
  ok(res, data, { fees });
}

export const byField = (field: "merchant" | "courier") => async (req: Request, res: Response) => {
  const { courierFee, companyFee, ...q } = reportQuery.parse(req.query);
  const { data, fees } = await reports.groupedReport(req, field, q, { courierFee, companyFee });
  ok(res, data, { fees });
};

export async function settlement(req: Request, res: Response) {
  const { orderIds, ...overrides } = settlementBody.parse(req.body);
  const { data, fees } = await reports.settlement(req, orderIds, overrides);
  ok(res, data, { fees });
}
