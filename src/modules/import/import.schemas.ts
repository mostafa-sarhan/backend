import { z } from "zod";
import { str, money } from "../../lib/validate";

export const importQuery = z.object({ mode: z.enum(["dry-run", "commit"]).default("dry-run") });

// One spreadsheet row after header mapping and normalisation.
export const importRow = z
  .object({
    fullName: str.name,
    phone: str.phone,
    address: str.address,
    cost: money,
    merchant: str.name, // merchant (company) name, resolved within the tenant
    description: str.note.optional(),
    reference: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
export type ImportRow = z.infer<typeof importRow>;

// Accepted column headers (Arabic or English, case-insensitive).
export const HEADER_ALIASES: Record<keyof ImportRow, string[]> = {
  fullName: ["اسم العميل", "الاسم", "العميل", "name", "full name", "fullname", "customer"],
  phone: ["رقم الهاتف", "الهاتف", "الموبايل", "phone", "mobile"],
  address: ["العنوان", "address"],
  cost: ["المبلغ", "القيمة", "cost", "amount", "price"],
  merchant: ["الشركة", "التاجر", "merchant", "company"],
  description: ["ملاحظات", "notes", "description"],
  reference: ["المرجع", "رقم الطلب", "reference", "ref", "order id"],
};

export const TEMPLATE_HEADERS = ["اسم العميل", "رقم الهاتف", "العنوان", "المبلغ", "الشركة", "ملاحظات", "المرجع"];
