import { randomBytes } from "crypto";
import { Tenant, PLAN_LIMITS, TRIAL_DAYS, Plan } from "../models/Tenant";
import { User } from "../models/User";
import { UNSCOPED } from "../lib/tenantPlugin";
import { AppError } from "../lib/errors";
import { hashPassword } from "../lib/password";

const DAY_MS = 24 * 60 * 60 * 1000;

// Random password that meets the policy; shown once to the platform admin, the owner changes it.
export const generateInitialPassword = () => `${randomBytes(12).toString("base64url")}a7`;

async function uniqueSlug(name: string, wanted?: string) {
  const base =
    (wanted || name)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `company-${randomBytes(3).toString("hex")}`;
  if (wanted && (await Tenant.exists({ slug: base }))) throw new AppError(409, "DUPLICATE", "Slug already taken");
  let slug = base;
  for (let i = 2; await Tenant.exists({ slug }); i++) slug = `${base}-${i}`;
  return slug;
}

export const planDefaults = (plan: Plan) => ({
  plan,
  limits: { ...PLAN_LIMITS[plan] },
  status: plan === "trial" ? ("trial" as const) : ("active" as const),
  trialEndsAt: plan === "trial" ? new Date(Date.now() + TRIAL_DAYS * DAY_MS) : null,
});

// New tenant + its first owner. Without transactions, a failed owner insert removes the tenant again.
export async function createTenantWithOwner(input: { name: string; slug?: string; plan: Plan; ownerEmail: string }) {
  if (await User.exists({ email: input.ownerEmail }).setOptions(UNSCOPED)) {
    throw new AppError(409, "DUPLICATE", "This email is already registered");
  }

  const tenant = await Tenant.create({ name: input.name, slug: await uniqueSlug(input.name, input.slug), ...planDefaults(input.plan) });
  const initialPassword = generateInitialPassword();
  try {
    const owner = await User.create({
      tenantId: tenant._id,
      email: input.ownerEmail,
      role: "owner",
      password: await hashPassword(initialPassword),
    });
    return { tenant, owner, initialPassword };
  } catch (err) {
    await Tenant.deleteOne({ _id: tenant._id });
    throw err;
  }
}
