import { z } from "zod";

export const outcomeBody = z
  .object({
    status: z.enum(["delivered", "returned", "refused", "exchanged"]),
    reason: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((b) => !["returned", "refused"].includes(b.status) || !!b.reason, { message: "A reason is required", path: ["reason"] });
