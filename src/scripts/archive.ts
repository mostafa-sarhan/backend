// One-off archive run, for an external cron when RUN_JOBS=false.
import { config } from "../config";
import { logger } from "../logger";
import { connectDb, disconnectDb } from "../db";
import { archiveOrders } from "../modules/orders/archive.job";

connectDb(config.mongoUri)
  .then(() => archiveOrders())
  .then((count) => logger.info({ count }, "Archived orders"))
  .catch((err) => {
    logger.error({ err }, "Archive failed");
    process.exitCode = 1;
  })
  .finally(disconnectDb);
