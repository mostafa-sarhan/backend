import cron from "node-cron";
import { orderModel, FINAL_STATUSES } from "../models/order";

const ARCHIVE_AFTER_DAYS = 3;

// Archives orders that reached a final status more than 3 days ago.
// Orders saved before `deliveredAt` existed fall back to `updatedAt`.
export async function archiveOrders() {
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const result = await orderModel.updateMany(
    {
      isArchived: false,
      status: { $in: FINAL_STATUSES },
      $or: [
        { deliveredAt: { $lte: cutoff } },
        { deliveredAt: { $exists: false }, updatedAt: { $lte: cutoff } },
      ],
    },
    { $set: { isArchived: true } },
    { timestamps: false }
  );

  return result.modifiedCount;
}

export function startArchiveJob() {
  const run = () =>
    archiveOrders()
      .then((count) => count && console.log(`📦 Archived ${count} orders`))
      .catch((err) => console.error("Archive job error:", err));

  run();
  cron.schedule("0 * * * *", run); // hourly
}
