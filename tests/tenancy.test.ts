import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, useDb, createTenant, loginAs, seedRefs, orderInput, createUser, PASSWORD, UNSCOPED } from "./helpers";
import { Order } from "../src/modules/orders/order.model";
import { User } from "../src/modules/users/user.model";
import { Courier } from "../src/modules/couriers/courier.model";
import { Tenant } from "../src/modules/tenants/tenant.model";
import { TenantScopeError } from "../src/lib/tenantPlugin";

useDb();

// Two companies with the same kind of data. Everything below is done as tenant B against A's ids.
async function twoTenants() {
  const tA = await createTenant("Alpha");
  const tB = await createTenant("Beta");
  const refsA = await seedRefs(tA);
  const refsB = await seedRefs(tB);
  const a = await loginAs("admin", "admin@alpha.test", tA);
  const b = await loginAs("admin", "admin@beta.test", tB);
  const orderA = (await a.post("/orders").send(orderInput(refsA.merchant, { cost: 111, courier: refsA.courier }))).body.data;
  const orderB = (await b.post("/orders").send(orderInput(refsB.merchant, { cost: 222 }))).body.data;
  const userA = await User.findOne({ email: "admin@alpha.test" }).setOptions(UNSCOPED);
  return { tA, tB, refsA, refsB, a, b, orderA, orderB, userA: userA! };
}

describe("model-level guard (fails closed)", () => {
  it("rejects queries, aggregates and bulk writes without tenantId", async () => {
    await expect(Order.find({})).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Order.findById("64b000000000000000000000")).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Order.countDocuments({ status: "pending" })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Order.updateMany({}, { $set: { cost: 0 } })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Order.deleteMany({})).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Order.aggregate([{ $group: { _id: "$status" } }])).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Order.bulkWrite([{ deleteMany: { filter: {} } }])).rejects.toBeInstanceOf(TenantScopeError);
    await expect(User.findOne({ email: "x@y.z" })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Courier.exists({ name: "Ali" })).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("refuses documents without a tenant", async () => {
    await expect(Courier.create({ name: "Nobody" })).rejects.toThrow(/tenantId/);
  });

  it("tenantId can't be changed after creation", async () => {
    const { tB, orderA } = await twoTenants();
    await Order.updateOne({ _id: orderA._id, tenantId: orderA.tenantId }, { $set: { tenantId: tB._id } });
    expect((await Order.findById(orderA._id).setOptions(UNSCOPED))!.tenantId.toString()).toBe(orderA.tenantId);
  });
});

describe("tenant B can't see or touch tenant A", () => {
  it("lists, stats, exports and reports only contain B's data", async () => {
    const { b, orderB } = await twoTenants();
    const list = await b.get("/orders").query({ archived: "all" });
    expect(list.body.data.map((o: { _id: string }) => o._id)).toEqual([orderB._id]);
    expect(list.body.meta).toMatchObject({ total: 1, totalCost: 222 });

    expect((await b.get("/orders/stats")).body.data).toEqual({ pending: 1 });
    expect((await b.get("/orders/export")).body.data).toHaveLength(1);
    expect((await b.get("/reports/summary").query({ archived: "all" })).body.data.total).toEqual({ count: 1, amount: 222 });
    const merchants = (await b.get("/reports/merchants").query({ archived: "all" })).body.data;
    expect(merchants.map((m: { total: { amount: number } }) => m.total.amount)).toEqual([222]);
    const couriers = (await b.get("/reports/couriers").query({ archived: "all" })).body.data;
    expect(couriers.flatMap((c: { total: { amount: number } }) => c.total.amount)).toEqual([222]);
  });

  it("A's order ids are 404 for B (read, edit, delete, history, barcode)", async () => {
    const { b, orderA } = await twoTenants();
    expect((await b.get(`/orders/${orderA._id}`)).status).toBe(404);
    expect((await b.patch(`/orders/${orderA._id}`).send({ description: "x" })).status).toBe(404);
    expect((await b.delete(`/orders/${orderA._id}`)).status).toBe(404);
    expect((await b.get(`/orders/${orderA._id}/history`)).status).toBe(404);
    expect((await b.get(`/orders/barcode/${orderA.barcode}`)).status).toBe(404);
  });

  it("bulk actions and settlement ignore or reject A's ids", async () => {
    const { b, orderA, refsB } = await twoTenants();
    expect((await b.post("/orders/bulk/assign").send({ orderIds: [orderA._id], courier: refsB.courier })).status).toBe(404);
    expect((await b.post("/orders/bulk/status").send({ updates: [{ id: orderA._id, status: "delivered" }] })).status).toBe(404);
    expect((await b.post("/reports/settlement").send({ orderIds: [orderA._id] })).body.data.total.count).toBe(0);
  });

  it("B can't reference A's merchant or courier", async () => {
    const { b, refsA, refsB, orderB } = await twoTenants();
    expect((await b.post("/orders").send(orderInput(refsA.merchant))).status).toBe(400);
    expect((await b.post("/orders").send(orderInput(refsB.merchant, { courier: refsA.courier }))).status).toBe(400);
    expect((await b.patch(`/orders/${orderB._id}`).send({ courier: refsA.courier, status: "with_courier" })).status).toBe(400);
    expect((await b.post("/orders/bulk/assign").send({ orderIds: [orderB._id], courier: refsA.courier })).status).toBe(409);
  });

  it("couriers, merchants, users and audit logs are per tenant", async () => {
    const { b, refsA, userA } = await twoTenants();
    expect((await b.get("/couriers")).body.data).toHaveLength(1);
    expect((await b.get("/merchants/options")).body.data).toHaveLength(1);
    expect((await b.get("/merchants")).body.data).toHaveLength(1);
    expect((await b.patch(`/couriers/${refsA.courier}`).send({ name: "Hacked" })).status).toBe(404);
    expect((await b.post(`/merchants/${refsA.merchant}/api-key`)).status).toBe(404);
    expect((await b.delete(`/merchants/${refsA.merchant}/api-key`)).status).toBe(404);
    expect((await b.patch(`/merchants/${refsA.merchant}`).send({ name: "Hacked" })).status).toBe(404);

    const users = (await b.get("/users")).body.data.map((u: { email: string }) => u.email);
    expect(users).toEqual(["admin@beta.test"]);
    expect((await b.put(`/users/${userA.id}/role`).send({ role: "employee" })).status).toBe(404);
    expect((await b.put(`/users/${userA.id}/password`).send({ newPassword: "N3wPassword!!" })).status).toBe(404);

    const logs = (await b.get("/users/audit-logs")).body.data;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l: { tenantId: string }) => l.tenantId === logs[0].tenantId)).toBe(true);
    expect(logs.some((l: { actor: { email: string } }) => l.actor?.email === "admin@alpha.test")).toBe(false);
  });

  it("names and barcodes may repeat across tenants", async () => {
    const { tA, tB, orderA } = await twoTenants();
    // Same courier name "Ali" already exists in both tenants (seedRefs).
    await Order.create({ tenantId: tB._id, ...orderInput(String((await seedRefs(await createTenant("Gamma"))).merchant)), barcode: orderA.barcode });
    await expect(Order.create({ tenantId: tA._id, fullName: "x", phone: "0100000000", address: "x", cost: 1, barcode: orderA.barcode })).rejects.toMatchObject({ code: 11000 });
  });

  it("a merchant API key only creates orders in its own tenant", async () => {
    const { a, b } = await twoTenants();
    const keyA = (await a.post("/merchants").send({ name: "ShopA" })).body.data.apiKey;
    const order = { fullName: "C", phone: "01001234567", address: "Giza", cost: 10, reference: "R1" };
    const res = await request(app).post("/merchants/order").set("api-key", keyA).send(order);
    expect(res.status).toBe(201);
    expect((await a.get(`/orders/${res.body.data.id}`)).status).toBe(200);
    expect((await b.get(`/orders/${res.body.data.id}`)).status).toBe(404);
  });

  it("emails are unique across the platform", async () => {
    const { b } = await twoTenants();
    const res = await b.post("/users").send({ email: "admin@alpha.test", password: "G00dPassword!", role: "employee" });
    expect(res.status).toBe(409);
  });
});

describe("tenant status", () => {
  it("a suspended tenant can't log in, loses existing sessions and its API keys", async () => {
    const tenant = await createTenant("Sus");
    const agent = await loginAs("admin", "admin@sus.test", tenant);
    const key = (await agent.post("/merchants").send({ name: "Shop" })).body.data.apiKey;

    await Tenant.updateOne({ _id: tenant._id }, { status: "suspended" });

    expect((await agent.get("/orders")).body.error.code).toBe("TENANT_SUSPENDED");
    expect((await agent.post("/auth/refresh")).body.error.code).toBe("TENANT_SUSPENDED");
    const login = await request(app).post("/auth/login").send({ email: "admin@sus.test", password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("TENANT_SUSPENDED");
    const api = await request(app).post("/merchants/order").set("api-key", key).send({ fullName: "C", phone: "01001234567", address: "x", cost: 1 });
    expect(api.status).toBe(403);
  });

  it("an expired trial is blocked", async () => {
    const tenant = await createTenant("Trial", { status: "trial", plan: "trial", trialEndsAt: new Date(Date.now() - 1000) });
    await createUser("owner", "owner@trial.test", tenant);
    const res = await request(app).post("/auth/login").send({ email: "owner@trial.test", password: PASSWORD });
    expect(res.body.error.code).toBe("TRIAL_EXPIRED");
  });
});

describe("plan limits", () => {
  it("maxUsers", async () => {
    const tenant = await createTenant("Small", { limits: { maxUsers: 2 } });
    const admin = await loginAs("admin", "admin@small.test", tenant);
    expect((await admin.post("/users").send({ email: "e1@small.test", password: "G00dPassword!", role: "employee" })).status).toBe(201);
    const res = await admin.post("/users").send({ email: "e2@small.test", password: "G00dPassword!", role: "employee" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("maxOrdersPerMonth (UI and merchant API)", async () => {
    const tenant = await createTenant("Tiny", { limits: { maxOrdersPerMonth: 1 } });
    const refs = await seedRefs(tenant);
    const admin = await loginAs("admin", "admin@tiny.test", tenant);
    expect((await admin.post("/orders").send(orderInput(refs.merchant))).status).toBe(201);
    expect((await admin.post("/orders").send(orderInput(refs.merchant))).body.error.code).toBe("PLAN_LIMIT_REACHED");
    const key = (await admin.post("/merchants").send({ name: "Shop" })).body.data.apiKey;
    const api = await request(app).post("/merchants/order").set("api-key", key).send({ fullName: "C", phone: "01001234567", address: "x", cost: 1 });
    expect(api.body.error.code).toBe("PLAN_LIMIT_REACHED");
  });
});

describe("owner role", () => {
  it("admins can't manage owners; the last owner can't be demoted", async () => {
    const tenant = await createTenant("Own");
    const owner = await loginAs("owner", "owner@own.test", tenant);
    const admin = await loginAs("admin", "admin@own.test", tenant);
    const ownerUser = await User.findOne({ email: "owner@own.test" }).setOptions(UNSCOPED);
    const adminUser = await User.findOne({ email: "admin@own.test" }).setOptions(UNSCOPED);

    expect((await admin.put(`/users/${ownerUser!.id}/role`).send({ role: "employee" })).status).toBe(403);
    expect((await admin.put(`/users/${ownerUser!.id}/password`).send({ newPassword: "N3wPassword!!" })).status).toBe(403);
    expect((await admin.post("/users").send({ email: "o2@own.test", password: "G00dPassword!", role: "owner" })).status).toBe(403);

    // Owner promotes the admin, then the new owner can't demote the only other... both are owners now:
    expect((await owner.put(`/users/${adminUser!.id}/role`).send({ role: "owner" })).status).toBe(200);
    const newOwner = await loginAs("owner", "admin@own.test", tenant);
    expect((await newOwner.put(`/users/${ownerUser!.id}/role`).send({ role: "admin" })).status).toBe(200);
    // Now admin@own.test is the last owner and can't be demoted (not even by themselves).
    expect((await newOwner.put(`/users/${adminUser!.id}/role`).send({ role: "admin" })).status).toBe(409);
  });

  it("users can change their own password and stay logged in", async () => {
    const agent = await loginAs("employee");
    const res = await agent.post("/auth/change-password").send({ currentPassword: PASSWORD, newPassword: "An0therGoodOne" });
    expect(res.status).toBe(200);
    expect((await agent.get("/auth/me")).status).toBe(200);
    expect((await request(app).post("/auth/login").send({ email: "employee@test.com", password: PASSWORD })).status).toBe(401);
  });
});
