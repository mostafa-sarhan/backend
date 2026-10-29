import { z } from "zod";
import { createOrderSchema, listQuerySchema } from "../orders/orders.schemas";
import { pagination, day } from "../../lib/validate";

// A merchant can't choose the merchant or the courier.
export const portalOrderBody = createOrderSchema.omit({ merchant: true, courier: true }).strict();
export const portalListQuery = listQuerySchema.pick({ search: true, status: true, date: true, from: true, to: true }).extend(pagination.shape);
export const statementQuery = z.object({ from: day.optional(), to: day.optional() });
