// Idempotent data migrations. Safe to run more than once:  npm run migrate
// Run once after deploying Phase B, before users log in.
import mongoose from "mongoose";
import { config } from "../config";
import { logger } from "../logger";
import { connectDb, disconnectDb } from "../db";
import { migrations } from "./migrations";

async function main() {
  await connectDb(config.mongoUri);
  const db = mongoose.connection.db!;
  for (const migration of migrations) {
    const result = await migration.run(db);
    logger.info({ migration: migration.name, ...result }, "Migration done");
  }
}

main()
  .catch((err) => {
    logger.error({ err }, "Migration failed");
    process.exitCode = 1;
  })
  .finally(disconnectDb);
