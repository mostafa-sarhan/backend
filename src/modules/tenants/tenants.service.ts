import { Request } from "express";
import { Tenant, TenantDoc, tenantBlock } from "./tenant.model";
import { User } from "../users/user.model";
import { Order } from "../orders/order.model";
import { AppError } from "../../lib/errors";

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

// Explicit limit, else none. (Plan defaults are copied onto the tenant when it's created or the plan changes.)
const limitReached = () => new AppError(403, "PLAN_LIMIT_REACHED", "Your plan's limit has been reached");

export async function assertUserQuota(req: Request) {
  const max = req.tenant!.limits?.maxUsers;
  if (max && (await User.countDocuments({ tenantId: req.tenant!._id })) >= max) throw limitReached();
}

// Orders created since the start of the current month (UTC; tenant timezone in step b).
export async function assertOrderQuota(tenant: TenantDoc, adding = 1) {
  const max = tenant.limits?.maxOrdersPerMonth;
  if (!max) return;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await Order.countDocuments({ tenantId: tenant._id, createdAt: { $gte: monthStart } });
  if (used + adding > max) throw limitReached();
}
