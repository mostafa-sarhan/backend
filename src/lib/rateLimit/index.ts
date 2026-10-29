import { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator, Store, IncrementResponse } from "express-rate-limit";
import { createHash } from "crypto";
import { AppError } from "../errors";
import { config } from "../../config";
import { CounterStore, createStore, MemoryStore } from "./store";

// Layered rate limits and the progressive login lockout. All limits come from config (env).
export const store: CounterStore = createStore();

// Test helper: start every test with empty counters.
export const resetRateLimits = () => (store instanceof MemoryStore ? store.clear() : undefined);

class StoreAdapter implements Store {
  windowMs = 60_000;
  constructor(public prefix: string) {}
  init(options: { windowMs: number }) {
    this.windowMs = options.windowMs;
  }
  async increment(key: string): Promise<IncrementResponse> {
    const { count, resetAt } = await store.hit(this.prefix + key, this.windowMs);
    return { totalHits: count, resetTime: resetAt };
  }
  async decrement(key: string) {
    await store.decrement(this.prefix + key);
  }
  async resetKey(key: string) {
    await store.reset(this.prefix + key);
  }
}

export const retryAfterSeconds = (resetAt: Date | undefined) => Math.max(1, Math.ceil(((resetAt?.getTime() ?? Date.now() + 60_000) - Date.now()) / 1000));

export function tooManyRequests(req: Request, limiter: string, seconds: number) {
  req.res?.setHeader("Retry-After", String(seconds));
  req.log?.warn({ limiter, retryAfter: seconds }, "Rate limit hit");
  return new AppError(429, "RATE_LIMITED", `عدد كبير من الطلبات، حاول مرة أخرى بعد ${seconds} ثانية`, { retryAfterSeconds: seconds, limiter });
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export const keys = {
  ip: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
  user: (req: Request) => req.user?.id ?? keys.ip(req),
  tenant: (req: Request) => req.tenant?._id.toString() ?? keys.ip(req),
  apiKey: (req: Request) => (typeof req.headers["api-key"] === "string" ? sha(req.headers["api-key"]) : keys.ip(req)),
};

export function limiter(name: string, opts: { windowMs: number; limit: number; key: (req: Request) => string; skipSuccessfulRequests?: boolean }): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    keyGenerator: opts.key,
    skipSuccessfulRequests: opts.skipSuccessfulRequests,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new StoreAdapter(`rl:${name}:`),
    // Our key generators normalise IPs (IPv6 /56); skip the library's own checks.
    validate: { keyGeneratorIpFallback: false, trustProxy: false, xForwardedForHeader: false },
    handler: (req, _res, next) =>
      next(tooManyRequests(req, name, retryAfterSeconds((req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime))),
  });
}

const MIN = 60_000;
const L = config.rateLimits;

export const limits = {
  global: limiter("global", { windowMs: 15 * MIN, limit: L.globalPer15Min, key: keys.ip }),
  login: limiter("login", { windowMs: 15 * MIN, limit: L.loginIpPer15Min, key: keys.ip }),
  platformLogin: limiter("platform-login", { windowMs: 15 * MIN, limit: L.platformLoginIpPer15Min, key: keys.ip }),
  refresh: limiter("refresh", { windowMs: 15 * MIN, limit: L.refreshIpPer15Min, key: keys.ip }),
  passwordChange: limiter("password-change", { windowMs: 15 * MIN, limit: L.passwordChangePer15Min, key: keys.user }),
  user: limiter("user", { windowMs: MIN, limit: L.userPerMin, key: keys.user }),
  tenant: limiter("tenant", { windowMs: MIN, limit: L.tenantPerMin, key: keys.tenant }),
  merchantApi: limiter("merchant-api", { windowMs: MIN, limit: L.merchantKeyPerMin, key: keys.apiKey }),
  tracking: limiter("tracking", { windowMs: MIN, limit: L.trackingIpPerMin, key: keys.ip }),
  accessRequest: limiter("access-request", { windowMs: 60 * MIN, limit: L.accessRequestIpPerHour, key: keys.ip }),
  export: limiter("export", { windowMs: 60 * MIN, limit: L.exportUserPerHour, key: keys.user }),
  import: limiter("import", { windowMs: 60 * MIN, limit: L.importUserPerHour, key: keys.user }),
};

// ---------------- Progressive login lockout (per email) ----------------
// Every `lockAfter` failures lock the account for the next, longer duration. Success clears it.
// Unknown emails are locked the same way, so lockouts reveal nothing.
const LOCK_STEPS_MS = [1, 5, 15, 60].map((m) => m * MIN);
const FAILURE_WINDOW_MS = 24 * 60 * MIN;

export function loginGuard(realm: "tenant" | "platform") {
  const lockAfter = realm === "platform" ? L.platformLoginLockAfter : L.loginLockAfter;
  const steps = realm === "platform" ? LOCK_STEPS_MS.map((ms) => ms * 5) : LOCK_STEPS_MS;
  const k = (email: string) => ({ fails: `lock:${realm}:fails:${sha(email)}`, lock: `lock:${realm}:until:${sha(email)}` });

  return {
    async assertNotLocked(req: Request, email: string) {
      const lock = await store.get(k(email).lock);
      if (lock) throw tooManyRequests(req, `${realm}-login-lockout`, retryAfterSeconds(lock.resetAt));
    },
    async recordFailure(email: string) {
      const { count } = await store.hit(k(email).fails, FAILURE_WINDOW_MS);
      if (count % lockAfter === 0) {
        const step = Math.min(count / lockAfter - 1, steps.length - 1);
        await store.block(k(email).lock, steps[step]);
      }
    },
    async recordSuccess(email: string) {
      await Promise.all([store.reset(k(email).fails), store.reset(k(email).lock)]);
    },
  };
}
