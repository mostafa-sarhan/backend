import { config } from "./config";
import { logger } from "./logger";
import { connectDb, disconnectDb } from "./db";
import { createApp } from "./app";
import { startArchiveJob } from "./modules/orders/archive.job";

async function main() {
  await connectDb(config.mongoUri);
  logger.info("MongoDB connected");

  const job = config.runJobs ? startArchiveJob() : null;
  const server = createApp().listen(config.port, () => logger.info(`Server running on port ${config.port}`));

  // Graceful shutdown: stop taking requests, let in-flight ones finish, then close the DB.
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, shutting down`);
    job?.stop();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "Startup failed");
  process.exit(1);
});
