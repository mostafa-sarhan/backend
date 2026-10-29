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
const num = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);

// Express "trust proxy": the number of reverse proxies in front of the API (e.g. 1 for nginx),
// or a list of proxy addresses. "true" would trust any X-Forwarded-For value, so it's refused.
export function parseTrustProxy(value: string | undefined): number | string | false {
  if (!value || value === "false" || value === "0") return false;
  if (value === "true") throw new Error("TRUST_PROXY=true is unsafe (spoofable X-Forwarded-For); use the number of proxies, e.g. 1");
  return /^\d+$/.test(value) ? Number(value) : value;
}
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
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  bodyLimit: process.env.BODY_LIMIT || "100kb",
  rateLimits: {
    globalPer15Min: num("RATE_LIMIT_GLOBAL_PER_15MIN", 1000),
    loginIpPer15Min: num("RATE_LIMIT_LOGIN_IP_PER_15MIN", 20),
    platformLoginIpPer15Min: num("RATE_LIMIT_PLATFORM_LOGIN_IP_PER_15MIN", 5),
    loginLockAfter: num("LOGIN_LOCK_AFTER_FAILURES", 5),
    platformLoginLockAfter: num("PLATFORM_LOGIN_LOCK_AFTER_FAILURES", 3),
    refreshIpPer15Min: num("RATE_LIMIT_REFRESH_IP_PER_15MIN", 60),
    passwordChangePer15Min: num("RATE_LIMIT_PASSWORD_CHANGE_PER_15MIN", 5),
    userPerMin: num("RATE_LIMIT_USER_PER_MIN", 300),
    tenantPerMin: num("RATE_LIMIT_TENANT_PER_MIN", 3000),
    merchantKeyPerMin: num("RATE_LIMIT_MERCHANT_KEY_PER_MIN", 60),
    trackingIpPerMin: num("RATE_LIMIT_TRACKING_IP_PER_MIN", 20),
    accessRequestIpPerHour: num("RATE_LIMIT_ACCESS_REQUEST_IP_PER_HOUR", 5),
    exportUserPerHour: num("RATE_LIMIT_EXPORT_USER_PER_HOUR", 30),
    importUserPerHour: num("RATE_LIMIT_IMPORT_USER_PER_HOUR", 10),
  },
};
