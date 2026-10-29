import { z } from "zod";
import { money, objectId } from "../../lib/validate";
import { listQuerySchema } from "../orders/orders.schemas";

// Optional "what-if" fees (admins only).
export const feeOverrides = z.object({ courierFee: money.optional(), companyFee: money.optional() });
export const reportQuery = listQuerySchema.extend(feeOverrides.shape);
export const settlementBody = z.object({ orderIds: z.array(objectId).min(1).max(500) }).extend(feeOverrides.shape).strict();
