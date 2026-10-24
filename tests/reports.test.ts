import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, useDb, loginAs, seedRefs, orderInput } from "./helpers";
import { Merchant } from "../src/models/Merchant";

useDb();

async function deliveredOrders() {
  const refs = await seedRefs();
  const admin = await loginAs("admin");
  const ids: string[] = [];
  for (const [cost, status] of [[100, "delivered"], [200, "delivered"], [50, "returned"]] as const) {
    const order = (await admin.post("/orders").send(orderInput(refs.merchant, { cost, courier: refs.courier }))).body.data;
    await admin.patch(`/orders/${order._id}`).send({ status });
    ids.push(order._id);
  }
  await admin.post("/orders").send(orderInput(refs.merchant, { cost: 70 })); // still pending
  return { admin, refs, ids };
}

describe("reports use the one server formula", () => {
  it("summary", async () => {
    const { admin } = await deliveredOrders();
    const res = await admin.get("/reports/summary").query({ archived: "all" });
    expect(res.body.meta.fees).toEqual({ courier: 20, company: 10 });
    expect(res.body.data.total).toEqual({ count: 4, amount: 420 });
    expect(res.body.data.byStatus.returned).toEqual({ count: 1, amount: 50 });
    expect(res.body.data.money).toEqual({
      deliveredCount: 2,
      deliveredTotal: 300,
      courierCommission: 40,
      companyCommission: 20,
      afterCourier: 260,
      merchantNet: 280, // courier fee is internal, not deducted from the merchant
    });
  });

  it("admins can try other fees", async () => {
    const { admin } = await deliveredOrders();
    const res = await admin.get("/reports/summary").query({ archived: "all", courierFee: 30, companyFee: 15 });
    expect(res.body.data.money).toMatchObject({ courierCommission: 60, companyCommission: 30, merchantNet: 300 - 30 });
  });

  it("per merchant and per courier reports match the summary", async () => {
    const { admin } = await deliveredOrders();
    const merchants = (await admin.get("/reports/merchants").query({ archived: "all" })).body.data;
    expect(merchants).toHaveLength(1);
    expect(merchants[0]).toMatchObject({ merchant: { name: "Acme" }, money: { merchantNet: 280 } });

    const couriers = (await admin.get("/reports/couriers").query({ archived: "all" })).body.data;
    const ali = couriers.find((c: { courier: { name: string } | null }) => c.courier?.name === "Ali");
    expect(ali.money.courierCommission).toBe(40);
    expect(couriers.find((c: { courier: unknown }) => c.courier === null).total.count).toBe(1); // unassigned
  });

  it("settlement ignores fee overrides from employees", async () => {
    const { ids } = await deliveredOrders();
    const employee = await loginAs("employee");
    const res = await employee.post("/reports/settlement").send({ orderIds: ids, courierFee: 0 });
    expect(res.body.data.money.courierCommission).toBe(40);
  });
});

describe("merchant API keys", () => {
  it("are shown once, stored hashed, and can be rotated and revoked", async () => {
    const admin = await loginAs("admin");
    const createdRes = await admin.post("/merchants").send({ name: "Shop" });
    const key = createdRes.body.data.apiKey;
    expect(key).toMatch(/^mk_/);

    const list = await admin.get("/merchants");
    expect(JSON.stringify(list.body)).not.toContain(key);
    const stored = await Merchant.findOne({ name: "Shop" }).select("+apiKeyHash").lean();
    expect(stored!.apiKeyHash).not.toBe(key);

    const order = { fullName: "C", phone: "01001234567", address: "Giza", cost: 0, reference: "A-1" };
    const ok = await request(app).post("/merchants/order").set("api-key", key).send(order);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ reference: "A-1", status: "pending" });

    const rotated = await admin.post(`/merchants/${stored!._id}/api-key`);
    const newKey = rotated.body.data.apiKey;
    expect((await request(app).post("/merchants/order").set("api-key", key).send({ ...order, reference: "A-2" })).status).toBe(401);
    expect((await request(app).post("/merchants/order").set("api-key", newKey).send({ ...order, reference: "A-2" })).status).toBe(201);

    await admin.delete(`/merchants/${stored!._id}/api-key`);
    expect((await request(app).post("/merchants/order").set("api-key", newKey).send({ ...order, reference: "A-3" })).status).toBe(401);
  });

  it("duplicate references only conflict within the same merchant", async () => {
    const admin = await loginAs("admin");
    const a = (await admin.post("/merchants").send({ name: "A" })).body.data.apiKey;
    const b = (await admin.post("/merchants").send({ name: "B" })).body.data.apiKey;
    const order = { fullName: "C", phone: "01001234567", address: "Giza", cost: 10, reference: "SAME" };

    expect((await request(app).post("/merchants/order").set("api-key", a).send(order)).status).toBe(201);
    expect((await request(app).post("/merchants/order").set("api-key", a).send(order)).status).toBe(409);
    expect((await request(app).post("/merchants/order").set("api-key", b).send(order)).status).toBe(201);
  });
});
