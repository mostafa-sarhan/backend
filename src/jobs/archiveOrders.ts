import cron from "node-cron";
import { Order } from "../models/Order";
import { FINAL_STATUSES } from "../domain/orderStatus";
import { logger } from "../logger";

const ARCHIVE_AFTER_DAYS = 3;

// Archives orders that reached a final status more than 3 days ago.
export async function archiveOrders(now = new Date()) {
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const result = await Order.updateMany(
    {
      isArchived: false,
      status: { $in: FINAL_STATUSES },
      // Orders closed before deliveredAt existed fall back to updatedAt.
      $or: [{ deliveredAt: { $lte: cutoff } }, { deliveredAt: null, updatedAt: { $lte: cutoff } }],
    },
    { $set: { isArchived: true } },
    { timestamps: false }
  );

  return result.modifiedCount;
}

export function startArchiveJob() {
  const run = () =>
    archiveOrders()
      .then((count) => count && logger.info({ count }, "Archived orders"))
      .catch((err) => logger.error({ err }, "Archive job failed"));

  run();
  return cron.schedule("0 * * * *", run); // hourly
}
