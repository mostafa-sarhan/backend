import cron from "node-cron";
import { Order } from "./order.model";
import { Tenant } from "../tenants/tenant.model";
import { FINAL_STATUSES } from "./orderStatus";
import { logger } from "../../logger";

const DAY_MS = 24 * 60 * 60 * 1000;

// Archives each tenant's orders that reached a final status more than `archiveAfterDays` ago.
export async function archiveOrders(now = new Date()) {
  let total = 0;
  for await (const tenant of Tenant.find().select("settings.archiveAfterDays")) {
    const cutoff = new Date(now.getTime() - (tenant.settings?.archiveAfterDays ?? 3) * DAY_MS);
    const result = await Order.updateMany(
      {
        tenantId: tenant._id,
        isArchived: false,
        status: { $in: FINAL_STATUSES },
        // Orders closed before deliveredAt existed fall back to updatedAt.
        $or: [{ deliveredAt: { $lte: cutoff } }, { deliveredAt: null, updatedAt: { $lte: cutoff } }],
      },
      { $set: { isArchived: true } },
      { timestamps: false }
    );
    total += result.modifiedCount;
  }
  return total;
}

export function startArchiveJob() {
  const run = () =>
    archiveOrders()
      .then((count) => count && logger.info({ count }, "Archived orders"))
      .catch((err) => logger.error({ err }, "Archive job failed"));

  run();
  return cron.schedule("0 * * * *", run); // hourly
}
