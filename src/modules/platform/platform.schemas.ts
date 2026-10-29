import { z } from "zod";
import { PLANS, TENANT_STATUSES } from "../tenants/tenant.model";
import { ACCESS_REQUEST_STATUSES } from "./accessRequest.model";
import { str, pagination } from "../../lib/validate";

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/);
const limit = z.number().int().min(1).nullable();

export const tenantListQuery = pagination.extend({ status: z.enum(TENANT_STATUSES).optional() });

export const createTenantBody = z
  .object({ name: z.string().trim().min(2).max(120), slug: slug.optional(), plan: z.enum(PLANS).default("trial"), ownerEmail: str.email })
  .strict();

export const updateTenantBody = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    plan: z.enum(PLANS).optional(),
    status: z.enum(TENANT_STATUSES).optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    limits: z.object({ maxUsers: limit.optional(), maxOrdersPerMonth: limit.optional() }).strict().optional(),
  })
  .strict();
export type UpdateTenantInput = z.infer<typeof updateTenantBody>;

export const accessRequestListQuery = pagination.extend({ status: z.enum(ACCESS_REQUEST_STATUSES).optional() });
export const approveBody = z.object({ plan: z.enum(PLANS).default("trial"), slug: slug.optional() }).strict();
export const rejectBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

// Public form. `website` is a honeypot: humans never see or fill it.
export const accessRequestBody = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    contactName: str.name,
    phone: str.phone,
    email: str.email,
    message: z.string().trim().max(1000).optional(),
    website: z.string().max(200).optional(),
  })
  .strict();
