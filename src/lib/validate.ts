import { z } from "zod";
import mongoose from "mongoose";

export const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(v), { message: "Invalid id" });

export const idParams = z.object({ id: objectId });

const text = (max: number) => z.string().trim().min(1).max(max);
export const str = {
  name: text(100),
  short: text(60),
  address: text(300),
  note: z.string().trim().max(1000),
  phone: z.string().trim().regex(/^\+?\d{6,15}$/, "Invalid phone number"),
  email: z.string().trim().toLowerCase().email().max(254),
  barcode: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/, "Invalid barcode"),
};

export const money = z.coerce.number().finite().min(0).max(10_000_000);

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
