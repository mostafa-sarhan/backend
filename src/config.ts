import dotenv from "dotenv";

// Tests configure themselves; never read a developer's .env there.
if (process.env.NODE_ENV !== "test") dotenv.config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const list = (value: string | undefined) =>
  (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const isProd = process.env.NODE_ENV === "production";
const sameSite = (process.env.COOKIE_SAMESITE || "strict").toLowerCase();
if (!["strict", "lax", "none"].includes(sameSite)) throw new Error("COOKIE_SAMESITE must be strict, lax or none");

export const config = {
  env: process.env.NODE_ENV || "development",
  isProd,
  port: Number(process.env.PORT) || 5000,
  mongoUri: required("MONGO_URI"),
  jwtSecret: required("JWT_SECRET"),
  corsOrigins: list(process.env.CORS_ORIGINS),
  logLevel: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  // Run the hourly archive job inside the API process (set false when an external cron runs `npm run archive`).
  runJobs: process.env.RUN_JOBS !== "false",
  cookies: {
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : true,
    sameSite: sameSite as "strict" | "lax" | "none",
    domain: process.env.COOKIE_DOMAIN || undefined,
  },
  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlSec: 7 * 24 * 60 * 60,
  bcryptRounds: 12,
  // Default fees until they are stored per company (Phase C).
  fees: {
    courier: Number(process.env.DEFAULT_COURIER_FEE ?? 20),
    company: Number(process.env.DEFAULT_COMPANY_FEE ?? 20),
  },
  exportMaxRows: Number(process.env.EXPORT_MAX_ROWS) || 5000,
};
