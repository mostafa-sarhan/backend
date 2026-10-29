import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, useDb, loginAs, orderInput, createTenant, UNSCOPED } from "./helpers";
import { Courier } from "../src/modules/couriers/courier.model";
import { Merchant } from "../src/modules/merchants/merchant.model";
import { User } from "../src/modules/users/user.model";
import { TenantDoc } from "../src/modules/tenants/tenant.model";

useDb();

const ONE_TIME = "OneT1mePassword";

// Logs in with a one-time password and sets a real one.
async function firstLogin(email: string) {
  const agent = request.agent(app);
  await agent.post("/auth/login").send({ email, password: ONE_TIME });
  const res = await agent.post("/auth/change-password").send({ currentPassword: ONE_TIME, newPassword: "MyOwnPassw0rd" });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return agent;
}

async function world(tenant?: TenantDoc) {
  const t = tenant ?? (await createTenant("World"));
  const [ali, omar] = await Promise.all([Courier.create({ tenantId: t._id, name: "Ali" }), Courier.create({ tenantId: t._id, name: "Omar" })]);
  const [acme, beta] = await Promise.all([Merchant.create({ tenantId: t._id, name: "Acme" }), Merchant.create({ tenantId: t._id, name: "Beta" })]);
  const admin = await loginAs("admin", `admin@${t.slug}.test`, t);
  const order = async (merchant: unknown, courier?: unknown, cost = 100) =>
    (await admin.post("/orders").send(orderInput(String(merchant), { cost, ...(courier ? { courier: String(courier) } : {}) }))).body.data;
  return { t, ali, omar, acme, beta, admin, order };
}

describe("courier accounts and app", () => {
  it("admins create one login per courier; couriers must set their own password", async () => {
    const { admin, ali, t } = await world();
    const res = await admin.post(`/couriers/${ali.id}/account`).send({ email: `ali@${t.slug}.test`, password: ONE_TIME });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: "courier", mustChangePassword: true });
    expect((await admin.post(`/couriers/${ali.id}/account`).send({ email: `ali2@${t.slug}.test`, password: ONE_TIME })).status).toBe(409);
    expect((await admin.get("/couriers")).body.data.find((c: { name: string }) => c.name === "Ali").account).toBe(`ali@${t.slug}.test`);
  });

  it("a courier sees and updates only their own open orders", async () => {
    const { admin, ali, omar, acme, order, t } = await world();
    await admin.post(`/couriers/${ali.id}/account`).send({ email: `ali@${t.slug}.test`, password: ONE_TIME });
    const mine = await order(acme._id, ali._id, 150);
    const theirs = await order(acme._id, omar._id);
    const pending = await order(acme._id);
    const courier = await firstLogin(`ali@${t.slug}.test`);

    const list = (await courier.get("/courier/orders")).body.data;
    expect(list.map((o: { _id: string }) => o._id)).toEqual([mine._id]);
    expect(list[0]).not.toHaveProperty("merchant");
    expect(list[0]).not.toHaveProperty("fees");

    expect((await courier.post(`/courier/orders/${theirs._id}/outcome`).send({ status: "delivered" })).status).toBe(404);
    expect((await courier.post(`/courier/orders/${pending._id}/outcome`).send({ status: "delivered" })).status).toBe(404);
    expect((await courier.post(`/courier/orders/${mine._id}/outcome`).send({ status: "returned" })).status).toBe(400); // reason required
    const done = await courier.post(`/courier/orders/${mine._id}/outcome`).send({ status: "delivered" });
    expect(done.body.data).toMatchObject({ status: "delivered" });
    expect((await courier.post(`/courier/orders/${mine._id}/outcome`).send({ status: "refused", reason: "x" })).body.error.code).toBe("INVALID_STATUS_TRANSITION"); // closed

    expect((await courier.get("/courier/today")).body.data).toEqual({ open: 0, delivered: 1, returned: 0, refused: 0, cashToHandOver: 150 });
  });

  it("records the reason for returned/refused", async () => {
    const { admin, ali, acme, order, t } = await world();
    await admin.post(`/couriers/${ali.id}/account`).send({ email: `ali@${t.slug}.test`, password: ONE_TIME });
    const o = await order(acme._id, ali._id);
    const courier = await firstLogin(`ali@${t.slug}.test`);
    const res = await courier.post(`/courier/orders/${o._id}/outcome`).send({ status: "refused", reason: "Customer not home" });
    expect(res.body.data).toMatchObject({ status: "refused", reason: "Customer not home" });
  });

  it("couriers can't use the staff API, and staff can't use the courier API", async () => {
    const { admin, ali, t } = await world();
    await admin.post(`/couriers/${ali.id}/account`).send({ email: `ali@${t.slug}.test`, password: ONE_TIME });
    const courier = await firstLogin(`ali@${t.slug}.test`);
    for (const path of ["/orders", "/orders/stats", "/couriers", "/merchants/options", "/settings", "/reports/summary", "/users", "/portal/orders"]) {
      expect((await courier.get(path)).status, path).toBe(403);
    }
    expect((await admin.get("/courier/orders")).status).toBe(403);
  });
});

describe("merchant portal", () => {
  async function portal() {
    const w = await world();
    await w.admin.post(`/merchants/${w.acme.id}/users`).send({ email: `shop@${w.t.slug}.test`, password: ONE_TIME });
    const merchant = await firstLogin(`shop@${w.t.slug}.test`);
    return { ...w, merchant };
  }

  it("lists only the merchant's own orders, without courier or fee details", async () => {
    const { merchant, order, acme, beta, ali } = await portal();
    const own = await order(acme._id, ali._id);
    const other = await order(beta._id);
    const list = (await merchant.get("/portal/orders")).body;
    expect(list.data.map((o: { _id: string }) => o._id)).toEqual([own._id]);
    expect(list.data[0]).not.toHaveProperty("courier");
    expect(list.data[0]).not.toHaveProperty("fees");
    expect((await merchant.get(`/portal/orders/${other._id}`)).status).toBe(404);
  });

  it("creates orders for itself only", async () => {
    const { merchant, beta, admin } = await portal();
    const input = { fullName: "C", phone: "01001234567", address: "Giza", cost: 75 };
    expect((await merchant.post("/portal/orders").send({ ...input, merchant: beta.id })).status).toBe(400);
    const res = await merchant.post("/portal/orders").send(input);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
    expect((await admin.get(`/orders/${res.body.data._id}`)).body.data.merchant.name).toBe("Acme");
  });

  it("statement follows the tenant's deductions and hides the courier fee by default", async () => {
    const { merchant, admin, order, acme, beta, ali } = await portal();
    for (const m of [acme, acme, beta]) {
      const o = await order(m._id, ali._id, 100);
      await admin.patch(`/orders/${o._id}`).send({ status: "delivered" });
    }
    const s = (await merchant.get("/portal/statement")).body.data;
    // Test tenants: courier fee 20, company fee 10.
    expect(s.money).toEqual({ deliveredCount: 2, deliveredTotal: 200, deductions: { company: 20 }, merchantNet: 180 });

    await admin.put("/settings").send({ merchantDeductions: ["company", "courier"] });
    expect((await merchant.get("/portal/statement")).body.data.money).toEqual({ deliveredCount: 2, deliveredTotal: 200, deductions: { company: 20, courier: 40 }, merchantNet: 140 });
  });

  it("can rotate its own API key, which then works on the merchant API", async () => {
    const { merchant } = await portal();
    expect((await merchant.get("/portal/api-key")).body.data.hasActiveKey).toBe(false);
    const { apiKey } = (await merchant.post("/portal/api-key")).body.data;
    const res = await request(app).post("/merchants/order").set("api-key", apiKey).send({ fullName: "C", phone: "01001234567", address: "x", cost: 1 });
    expect(res.status).toBe(201);
    expect((await merchant.get("/portal/orders")).body.meta.total).toBe(1);
  });

  it("merchants can't use the staff API", async () => {
    const { merchant } = await portal();
    for (const path of ["/orders", "/couriers", "/merchants", "/reports/summary", "/settings", "/courier/orders"]) {
      expect((await merchant.get(path)).status, path).toBe(403);
    }
  });

  it("is isolated per tenant", async () => {
    const a = await portal();
    const b = await world(await createTenant("Other"));
    const foreign = await b.order(b.acme._id);
    expect((await a.merchant.get(`/portal/orders/${foreign._id}`)).status).toBe(404);
    expect((await a.merchant.get("/portal/orders")).body.meta.total).toBe(0);
  });
});

describe("account links", () => {
  it("staff can't turn a courier or merchant login into staff, or create one directly", async () => {
    const { admin, ali, t } = await world();
    await admin.post(`/couriers/${ali.id}/account`).send({ email: `ali@${t.slug}.test`, password: ONE_TIME });
    const user = await User.findOne({ email: `ali@${t.slug}.test` }).setOptions(UNSCOPED);
    expect((await admin.put(`/users/${user!.id}/role`).send({ role: "admin" })).status).toBe(400);
    expect((await admin.post("/users").send({ email: "c@x.test", password: ONE_TIME, role: "courier" })).status).toBe(400);
  });
});
