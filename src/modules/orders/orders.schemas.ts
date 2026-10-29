import { z } from "zod";
import { ORDER_STATUSES } from "./orderStatus";
import { objectId, str, money, day, pagination } from "../../lib/validate";

// Strict schemas: unknown fields are rejected, so server-controlled fields can never be sent.
const orderFields = {
  fullName: str.name,
  phone: str.phone,
  address: str.address,
  cost: money,
  description: str.note,
  merchant: objectId,
  courier: objectId.nullable(),
  status: z.enum(ORDER_STATUSES),
  reason: z.string().trim().max(300).nullable(),
};

export const createOrderSchema = z
  .object({
    fullName: orderFields.fullName,
    phone: orderFields.phone,
    address: orderFields.address,
    cost: orderFields.cost,
    description: orderFields.description.optional(),
    merchant: orderFields.merchant,
    courier: objectId.optional(),
  })
  .strict();
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = z.object(orderFields).partial().strict();
export type OrderUpdate = z.infer<typeof updateOrderSchema>;

export const listQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9+-]*$/, "Digits or barcode characters only")
    .optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  merchant: objectId.optional(),
  courier: objectId.optional(),
  date: day.optional(),
  from: day.optional(),
  to: day.optional(),
  archived: z.enum(["true", "false", "all"]).default("false"),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const pagedListQuery = listQuerySchema.extend(pagination.shape);

export const barcodeParams = z.object({ barcode: str.barcode });

export const bulkAssignSchema = z.object({ orderIds: z.array(objectId).min(1).max(500), courier: objectId }).strict();

export const bulkStatusSchema = z
  .object({
    updates: z
      .array(z.object({ id: objectId, status: z.enum(ORDER_STATUSES) }).strict())
      .min(1)
      .max(500),
  })
  .strict();
