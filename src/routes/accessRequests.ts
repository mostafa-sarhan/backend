import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { AccessRequest } from "../models/AccessRequest";
import { AppError } from "../lib/errors";
import { created } from "../lib/respond";
import { str } from "../lib/validate";

// Public "Request access" form (landing page, Phase E).
const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many requests, try again later")),
});

const body = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    contactName: str.name,
    phone: str.phone,
    email: str.email,
    message: z.string().trim().max(1000).optional(),
  })
  .strict();

// Always the same answer, so the form can't be used to learn who already applied.
router.post("/", limiter, async (req, res) => {
  const input = body.parse(req.body);
  if (!(await AccessRequest.exists({ email: input.email, status: "pending" }))) await AccessRequest.create(input);
  created(res, { received: true });
});

export default router;
