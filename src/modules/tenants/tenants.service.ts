import { Request } from "express";
import { Tenant, TenantDoc, tenantBlock } from "./tenant.model";
import { User } from "../users/user.model";
import { Order } from "../orders/order.model";
import { AppError } from "../../lib/errors";
import { monthStart } from "../../lib/time";

export function assertTenantUsable(tenant: TenantDoc | null): asserts tenant is TenantDoc {
  if (!tenant) throw new AppError(401, "SESSION_EXPIRED", "Session expired");
  const block = tenantBlock(tenant);
  if (block === "TENANT_SUSPENDED") throw new AppError(403, block, "This company's account is suspended");
  if (block === "TRIAL_EXPIRED") throw new AppError(403, block, "The trial period has ended");
}

export async function loadUsableTenant(id: unknown) {
  const tenant = await Tenant.findById(id);
  assertTenantUsable(tenant);
  return tenant;
}

export type MerchantDeduction = "company" | "courier";

// A tenant's settings with defaults filled in. The one place the rest of the code reads them from.
export function tenantSettings(t: TenantDoc) {
  const s = t.settings;
  return {
    fees: { courier: s?.fees?.courier ?? 20, company: s?.fees?.company ?? 20 },
    merchantDeductions: (s?.merchantDeductions ?? ["company"]) as MerchantDeduction[], // [] = deduct nothing
    archiveAfterDays: s?.archiveAfterDays ?? 3,
    timezone: s?.timezone ?? "Africa/Cairo",
    currency: s?.currency ?? "EGP",
    labelName: s?.labelName ?? null,
    logoUrl: s?.logoUrl ?? null,
  };
}
export type TenantSettings = ReturnType<typeof tenantSettings>;

// Explicit limit, else none. (Plan defaults are copied onto the tenant when it's created or the plan changes.)
const limitReached = () => new AppError(403, "PLAN_LIMIT_REACHED", "Your plan's limit has been reached");

export async function assertUserQuota(req: Request) {
  const max = req.tenant!.limits?.maxUsers;
  if (max && (await User.countDocuments({ tenantId: req.tenant!._id })) >= max) throw limitReached();
}

// Orders created since the start of the current month in the tenant's timezone.
export async function assertOrderQuota(tenant: TenantDoc, adding = 1) {
  const max = tenant.limits?.maxOrdersPerMonth;
  if (!max) return;
  const since = monthStart(new Date(), tenantSettings(tenant).timezone);
  const used = await Order.countDocuments({ tenantId: tenant._id, createdAt: { $gte: since } });
  if (used + adding > max) throw limitReached();
}
