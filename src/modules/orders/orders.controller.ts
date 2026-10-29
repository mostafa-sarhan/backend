import { Request, Response } from "express";
import { ok, created } from "../../lib/respond";
import { idParams } from "../../lib/validate";
import { pagedListQuery, listQuerySchema, barcodeParams, createOrderSchema, updateOrderSchema, bulkAssignSchema, bulkStatusSchema } from "./orders.schemas";
import * as orders from "./orders.service";

export async function list(req: Request, res: Response) {
  const { page, limit, ...q } = pagedListQuery.parse(req.query);
  const { items, meta } = await orders.listOrders(req, q, page, limit);
  ok(res, items, meta);
}

export async function exportAll(req: Request, res: Response) {
  const { items, meta } = await orders.exportOrders(req, listQuerySchema.parse(req.query));
  ok(res, items, meta);
}

export async function stats(req: Request, res: Response) {
  ok(res, await orders.statusCounts(req));
}

export async function byBarcode(req: Request, res: Response) {
  ok(res, await orders.getOrder(req, barcodeParams.parse(req.params)));
}

export async function get(req: Request, res: Response) {
  ok(res, await orders.getOrder(req, { _id: idParams.parse(req.params).id }));
}

export async function history(req: Request, res: Response) {
  ok(res, await orders.orderHistory(req, idParams.parse(req.params).id));
}

export async function create(req: Request, res: Response) {
  created(res, await orders.createOrder(req, createOrderSchema.parse(req.body)));
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  await orders.updateOrder(req, id, updateOrderSchema.parse(req.body));
  ok(res, await orders.getOrder(req, { _id: id }));
}

export async function remove(req: Request, res: Response) {
  await orders.deleteOrder(req, idParams.parse(req.params).id);
  ok(res, { deleted: true });
}

export async function bulkAssign(req: Request, res: Response) {
  const { orderIds, courier } = bulkAssignSchema.parse(req.body);
  ok(res, await orders.bulkAssign(req, orderIds, courier));
}

export async function bulkStatus(req: Request, res: Response) {
  ok(res, await orders.bulkStatus(req, bulkStatusSchema.parse(req.body).updates));
}
