import { Order, TRACKING_ID_PATTERN } from "../orders/order.model";
import { Tenant, tenantBlock } from "../tenants/tenant.model";
import { tenantSettings } from "../tenants/tenants.service";
import { notFound } from "../../lib/errors";
import { UNSCOPED } from "../../lib/tenantPlugin";

// Public status of one order: timeline only. No name, phone, address, notes, reasons, merchant,
// courier or money. Orders of suspended/expired tenants are hidden.
export async function track(trackingId: string) {
  const id = trackingId.toUpperCase();
  if (!TRACKING_ID_PATTERN.test(id)) throw notFound("Shipment");

  // Cross-tenant by design: trackingId is globally unique and unguessable.
  const order = await Order.findOne({ trackingId: id }).setOptions(UNSCOPED).select("trackingId status statusHistory.status statusHistory.at tenantId updatedAt").lean();
  if (!order) throw notFound("Shipment");
  const tenant = await Tenant.findById(order.tenantId);
  if (!tenant || tenantBlock(tenant)) throw notFound("Shipment");

  const settings = tenantSettings(tenant);
  return {
    trackingId: order.trackingId,
    status: order.status,
    updatedAt: order.updatedAt,
    timeline: (order.statusHistory ?? []).map((e) => ({ status: e.status, at: e.at })),
    company: { name: settings.labelName || tenant.name, logoUrl: settings.logoUrl },
  };
}
