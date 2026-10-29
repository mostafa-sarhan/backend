import { z } from "zod";
import { str, money } from "../../lib/validate";

export const createMerchantBody = z.object({ name: str.name, withApiKey: z.boolean().default(true) }).strict();
export const renameMerchantBody = z.object({ name: str.name }).strict();

// `reference` is the merchant's own order id (`barcode` accepted as an alias for older integrations).
export const merchantOrderBody = z
  .object({
    fullName: str.name,
    phone: str.phone,
    address: str.address,
    cost: money,
    description: str.note.optional(),
    reference: z.string().trim().min(1).max(60).optional(),
    barcode: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
