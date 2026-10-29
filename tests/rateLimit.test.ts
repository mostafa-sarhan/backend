import { describe, it, expect, vi } from "vitest";

// Small limits for this file only (must run before the app/config modules load).
vi.hoisted(() => {
  Object.assign(process.env, {
    TRUST_PROXY: "1",
    RATE_LIMIT_GLOBAL_PER_15MIN: "1000",
    RATE_LIMIT_LOGIN_IP_PER_15MIN: "4",
    RATE_LIMIT_PLATFORM_LOGIN_IP_PER_15MIN: "2",
    RATE_LIMIT_REFRESH_IP_PER_15MIN: "2",
    RATE_LIMIT_PASSWORD_CHANGE_PER_15MIN: "2",
    RATE_LIMIT_USER_PER_MIN: "5",
    RATE_LIMIT_TENANT_PER_MIN: "8",
    RATE_LIMIT_MERCHANT_KEY_PER_MIN: "2",
    RATE_LIMIT_ACCESS_REQUEST_IP_PER_HOUR: "2",
    RATE_LIMIT_EXPORT_USER_PER_HOUR: "2",
    LOGIN_LOCK_AFTER_FAILURES: "3",
    PLATFORM_LOGIN_LOCK_AFTER_FAILURES: "2",
  });
});

import request from "supertest";
import { app, useDb, createUser, createTenant, loginAs, PASSWORD } from "./helpers";
import { PlatformAdmin } from "../src/modules/platform/platformAdmin.model";
import { hashPassword } from "../src/modules/auth/password";
import { parseTrustProxy } from "../src/config";
import { MemoryStore, MongoStore } from "../src/lib/rateLimit/store";

useDb();

// Each test uses its own client IP via X-Forwarded-For (trusted: TRUST_PROXY=1).
let ipCounter = 0;
const newIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const from = (ip: string) => ({ "X-Forwarded-For": ip });

function expect429(res: request.Response) {
  expect(res.status).toBe(429);
  expect(res.body.error.code).toBe("RATE_LIMITED");
  expect(res.body.error.message).toMatch(/حاول مرة أخرى/);
  expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
}

describe("trust proxy", () => {
  it("uses the last proxy hop, so a spoofed X-Forwarded-For doesn't give a fresh IP", async () => {
    await createUser("admin");
    const real = newIp();
    for (const spoof of ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]) {
      await request(app).post("/auth/login").set("X-Forwarded-For", `${spoof}, ${real}`).send({ email: "x@test.com", password: "bad" });
    }
    expect429(await request(app).post("/auth/login").set("X-Forwarded-For", `5.5.5.5, ${real}`).send({ email: "y@test.com", password: "bad" }));
    // A different real client is unaffected.
    expect((await request(app).post("/auth/login").set(from(newIp())).send({ email: "admin@test.com", password: PASSWORD })).status).toBe(200);
  });

  it("refuses TRUST_PROXY=true", () => {
    expect(() => parseTrustProxy("true")).toThrow(/unsafe/);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy(undefined)).toBe(false);
  });
});

describe("login protection", () => {
  it("per IP", async () => {
    const ip = newIp();
    for (let i = 0; i < 4; i++) await request(app).post("/auth/login").set(from(ip)).send({ email: `u${i}@test.com`, password: "bad" });
    expect429(await request(app).post("/auth/login").set(from(ip)).send({ email: "u9@test.com", password: "bad" }));
  });

  it("progressive lockout per email, even with the right password and from new IPs", async () => {
    await createUser("admin");
    for (let i = 0; i < 3; i++) await request(app).post("/auth/login").set(from(newIp())).send({ email: "admin@test.com", password: "bad" });
    const locked = await request(app).post("/auth/login").set(from(newIp())).send({ email: "admin@test.com", password: PASSWORD });
    expect429(locked);
    expect(Number(locked.headers["retry-after"])).toBeLessThanOrEqual(60); // first step: 1 minute
    // Other accounts are unaffected.
    await createUser("employee");
    expect((await request(app).post("/auth/login").set(from(newIp())).send({ email: "employee@test.com", password: PASSWORD })).status).toBe(200);
  });

  it("unknown emails lock the same way (no account enumeration)", async () => {
    for (let i = 0; i < 3; i++) await request(app).post("/auth/login").set(from(newIp())).send({ email: "ghost@test.com", password: "bad" });
    expect429(await request(app).post("/auth/login").set(from(newIp())).send({ email: "ghost@test.com", password: "bad" }));
  });

  it("success resets the failure count", async () => {
    await createUser("admin");
    const attempt = (password: string) => request(app).post("/auth/login").set(from(newIp())).send({ email: "admin@test.com", password });
    await attempt("bad");
    await attempt("bad");
    expect((await attempt(PASSWORD)).status).toBe(200);
    await attempt("bad");
    await attempt("bad");
    expect((await attempt(PASSWORD)).status).toBe(200);
  });

  it("platform login is stricter (per IP and lockout)", async () => {
    const ip = newIp();
    await request(app).post("/platform/auth/login").set(from(ip)).send({ email: "a@p.test", password: "bad" });
    await request(app).post("/platform/auth/login").set(from(ip)).send({ email: "b@p.test", password: "bad" });
    expect429(await request(app).post("/platform/auth/login").set(from(ip)).send({ email: "c@p.test", password: "bad" }));

    await PlatformAdmin.create({ email: "root@p.test", password: await hashPassword(PASSWORD), mustChangePassword: false });
    for (let i = 0; i < 2; i++) await request(app).post("/platform/auth/login").set(from(newIp())).send({ email: "root@p.test", password: "bad" });
    expect429(await request(app).post("/platform/auth/login").set(from(newIp())).send({ email: "root@p.test", password: PASSWORD }));
  });

  it("refresh per IP", async () => {
    const ip = newIp();
    for (let i = 0; i < 2; i++) await request(app).post("/auth/refresh").set(from(ip));
    expect429(await request(app).post("/auth/refresh").set(from(ip)));
  });

  it("password change: per user, and wrong current passwords count toward the lockout", async () => {
    const agent = await loginAs("employee");
    await agent.post("/auth/change-password").set(from(newIp())).send({ currentPassword: "bad", newPassword: "N3wPassword!!" });
    await agent.post("/auth/change-password").set(from(newIp())).send({ currentPassword: "bad", newPassword: "N3wPassword!!" });
    expect429(await agent.post("/auth/change-password").set(from(newIp())).send({ currentPassword: PASSWORD, newPassword: "N3wPassword!!" }));
  });
});

describe("API limits", () => {
  it("per user", async () => {
    const agent = await loginAs("admin");
    for (let i = 0; i < 5; i++) expect((await agent.get("/orders/stats").set(from(newIp()))).status).toBe(200);
    expect429(await agent.get("/orders/stats").set(from(newIp())));
  });

  it("per tenant ceiling across users", async () => {
    const tenant = await createTenant("Busy");
    const a = await loginAs("admin", "a@busy.test", tenant);
    const b = await loginAs("employee", "b@busy.test", tenant);
    for (let i = 0; i < 4; i++) await a.get("/orders/stats").set(from(newIp()));
    for (let i = 0; i < 4; i++) await b.get("/orders/stats").set(from(newIp()));
    expect429(await b.get("/orders/stats").set(from(newIp())));
    // Another tenant is unaffected.
    const other = await loginAs("admin", "x@other.test", await createTenant("Other"));
    expect((await other.get("/orders/stats").set(from(newIp()))).status).toBe(200);
  });

  it("merchant API per key", async () => {
    const admin = await loginAs("admin");
    const key = (await admin.post("/merchants").send({ name: "Shop" })).body.data.apiKey;
    const order = { fullName: "C", phone: "01001234567", address: "x", cost: 1 };
    for (let i = 0; i < 2; i++) expect((await request(app).post("/merchants/order").set(from(newIp())).set("api-key", key).send(order)).status).toBe(201);
    expect429(await request(app).post("/merchants/order").set(from(newIp())).set("api-key", key).send(order));
  });

  it("export per user", async () => {
    const admin = await loginAs("admin");
    for (let i = 0; i < 2; i++) expect((await admin.get("/orders/export")).status).toBe(200);
    expect429(await admin.get("/orders/export"));
  });
});

describe("access-request form", () => {
  const body = { companyName: "Speedy", contactName: "Mona", phone: "01001112222", email: "m@s.test" };
  it("per IP", async () => {
    const ip = newIp();
    for (let i = 0; i < 2; i++) await request(app).post("/access-requests").set(from(ip)).send({ ...body, email: `m${i}@s.test` });
    expect429(await request(app).post("/access-requests").set(from(ip)).send(body));
  });
});

describe("stores", () => {
  for (const [name, make] of [["memory", () => new MemoryStore()], ["mongo", () => new MongoStore()]] as const) {
    it(`${name}: fixed window, decrement, block, reset`, async () => {
      const s = make();
      expect((await s.hit("k", 60_000)).count).toBe(1);
      expect((await s.hit("k", 60_000)).count).toBe(2);
      await s.decrement("k");
      expect((await s.get("k"))!.count).toBe(1);
      await s.block("lock", 30_000);
      expect((await s.get("lock"))!.resetAt.getTime()).toBeGreaterThan(Date.now() + 25_000);
      await s.reset("k");
      expect(await s.get("k")).toBeNull();
      expect((await s.hit("short", 1)).count).toBe(1);
      await new Promise((r) => setTimeout(r, 5));
      expect((await s.hit("short", 1)).count).toBe(1); // new window
    });
  }
});
