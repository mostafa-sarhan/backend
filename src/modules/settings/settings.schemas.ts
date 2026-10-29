import { z } from "zod";
import { money } from "../../lib/validate";
import { isValidTimezone } from "../../lib/time";

// ISO-4217 codes the runtime knows about.
const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const isCurrency = (c: string) => CURRENCIES.has(c);

export const updateSettingsBody = z
  .object({
    fees: z.object({ courier: money, company: money }).strict().optional(),
    // Which commissions are deducted from the merchant's money.
    merchantDeductions: z
      .array(z.enum(["company", "courier"]))
      .max(2)
      .refine((a) => new Set(a).size === a.length, "Duplicate entries")
      .optional(),
    archiveAfterDays: z.number().int().min(1).max(365).optional(),
    timezone: z.string().max(60).refine(isValidTimezone, "Unknown timezone").optional(),
    currency: z.string().length(3).toUpperCase().refine(isCurrency, "Unknown currency").optional(),
    labelName: z.string().trim().max(120).nullable().optional(),
    logoUrl: z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "Must be https").nullable().optional(),
  })
  .strict();
export type UpdateSettingsInput = z.infer<typeof updateSettingsBody>;
