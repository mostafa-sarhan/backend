import { Request } from "express";
import { Tenant } from "../tenants/tenant.model";
import { tenantSettings, TenantSettings } from "../tenants/tenants.service";
import { recordAudit, diff } from "../audit/audit.service";
import { notFound } from "../../lib/errors";
import { withTransaction } from "../../lib/transaction";
import { UpdateSettingsInput } from "./settings.schemas";

export const getSettings = (req: Request) => tenantSettings(req.tenant!);

const flat = (s: TenantSettings) => ({
  courierFee: s.fees.courier,
  companyFee: s.fees.company,
  merchantDeductions: s.merchantDeductions.join(","),
  archiveAfterDays: s.archiveAfterDays,
  timezone: s.timezone,
  currency: s.currency,
  labelName: s.labelName,
  logoUrl: s.logoUrl,
});

// Fee changes only affect orders delivered afterwards: delivered orders keep their fee snapshot.
export async function updateSettings(req: Request, input: UpdateSettingsInput) {
  return withTransaction(async () => {
    const tenant = await Tenant.findById(req.tenant!._id);
    if (!tenant) throw notFound("Tenant");
    const before = tenantSettings(tenant);
    for (const [key, value] of Object.entries(input)) tenant.set(`settings.${key}`, value);
    await tenant.save();
    const after = tenantSettings(tenant);
    await recordAudit(req, { entity: "settings", entityId: tenant._id, action: "UPDATE_SETTINGS", label: tenant.name, changes: diff(flat(before), flat(after)) });
    return after;
  });
}
