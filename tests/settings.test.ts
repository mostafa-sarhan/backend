import { describe, it, expect } from "vitest";
import { useDb, loginAs, seedRefs, orderInput, createTenant, UNSCOPED } from "./helpers";
import { Order } from "../src/modules/orders/order.model";
import { AuditEvent } from "../src/modules/audit/auditEvent.model";

useDb();

async function deliver(agent: Awaited<ReturnType<typeof loginAs>>, refs: { merchant: string; courier: string }, cost = 100) {
  const order = (await agent.post("/orders").send(orderInput(refs.merchant, { cost, courier: refs.courier }))).body.data;
  const res = await agent.patch(`/orders/${order._id}`).send({ status: "delivered" });
  return res.body.data;
}

describe("settings API", () => {
  it("defaults: Africa/Cairo, EGP, company fee deducted", async () => {
    const tenant = await createTenant("Fresh", { settings: undefined });
    const admin = await loginAs("admin", "a@fresh.test", tenant);
    expect((await admin.get("/settings")).body.data).toEqual({
      fees: { courier: 20, company: 20 },
      merchantDeductions: ["company"],
      archiveAfterDays: 3,
      timezone: "Africa/Cairo",
      currency: "EGP",
      labelName: null,
      logoUrl: null,
    });
  });

  it("admins update, employees only read, changes are audited", async () => {
    const admin = await loginAs("admin");
    const employee = await loginAs("employee");
    expect((await employee.get("/settings")).status).toBe(200);
    expect((await employee.put("/settings").send({ archiveAfterDays: 7 })).status).toBe(403);

    const res = await admin.put("/settings").send({ fees: { courier: 25, company: 15 }, timezone: "Asia/Riyadh", currency: "sar", labelName: "Acme", logoUrl: "https://cdn.example.com/l.png" });
    expect(res.body.data).toMatchObject({ fees: { courier: 25, company: 15 }, timezone: "Asia/Riyadh", currency: "SAR", labelName: "Acme" });
    const event = await AuditEvent.findOne({ action: "UPDATE_SETTINGS" }).setOptions(UNSCOPED);
    expect(event!.changes).toMatchObject({ courierFee: { from: 20, to: 25 }, timezone: { from: "Africa/Cairo", to: "Asia/Riyadh" } });
  });

  it("validates input", async () => {
    const admin = await loginAs("admin");
    for (const body of [
      { timezone: "Mars/Base" },
      { currency: "XXQ" },
      { logoUrl: "http://insecure.example.com/x.png" },
      { merchantDeductions: ["company", "company"] },
      { fees: { courier: -1, company: 1 } },
      { archiveAfterDays: 0 },
      { unknown: 1 },
    ]) {
      expect((await admin.put("/settings").send(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("is per tenant", async () => {
    const a = await loginAs("admin", "a@one.test", await createTenant("One"));
    const b = await loginAs("admin", "b@two.test", await createTenant("Two"));
    await a.put("/settings").send({ archiveAfterDays: 9 });
    expect((await b.get("/settings")).body.data.archiveAfterDays).toBe(3);
  });
});

describe("fee snapshots", () => {
  it("delivered orders keep the fees in force at delivery", async () => {
    const refs = await seedRefs();
    const admin = await loginAs("admin");
    const first = await deliver(admin, refs);
    expect(first.fees).toEqual({ courier: 20, company: 10 });

    await admin.put("/settings").send({ fees: { courier: 50, company: 30 } });
    const second = await deliver(admin, refs);
    expect(second.fees).toEqual({ courier: 50, company: 30 });

    const money = (await admin.get("/reports/summary").query({ archived: "all" })).body.data.money;
    expect(money).toMatchObject({ deliveredCount: 2, courierCommission: 70, companyCommission: 40, merchantNet: 200 - 40 });
  });

  it("a merchant's company-fee override is used, and only admins set it", async () => {
    const refs = await seedRefs();
    const admin = await loginAs("admin");
    const employee = await loginAs("employee");
    expect((await employee.patch(`/merchants/${refs.merchant}`).send({ companyFee: 15 })).status).toBe(403);
    expect((await admin.patch(`/merchants/${refs.merchant}`).send({ companyFee: 15 })).body.data.companyFee).toBe(15);
    expect((await deliver(admin, refs)).fees).toEqual({ courier: 20, company: 15 });

    await admin.patch(`/merchants/${refs.merchant}`).send({ companyFee: null });
    expect((await deliver(admin, refs)).fees).toEqual({ courier: 20, company: 10 });
  });

  it("reopening a delivered order drops the snapshot; re-delivering takes current fees", async () => {
    const refs = await seedRefs();
    const admin = await loginAs("admin");
    const order = await deliver(admin, refs);
    await admin.put("/settings").send({ fees: { courier: 5, company: 5 } });
    expect((await admin.patch(`/orders/${order._id}`).send({ status: "with_courier" })).body.data.fees).toBeNull();
    expect((await admin.patch(`/orders/${order._id}`).send({ status: "delivered" })).body.data.fees).toEqual({ courier: 5, company: 5 });
  });

  it("the deduction setting changes the merchant net", async () => {
    const refs = await seedRefs();
    const admin = await loginAs("admin");
    await deliver(admin, refs, 100);
    const net = async () => (await admin.get("/reports/summary").query({ archived: "all" })).body.data.money.merchantNet;
    expect(await net()).toBe(90);
    await admin.put("/settings").send({ merchantDeductions: ["company", "courier"] });
    expect(await net()).toBe(70);
    await admin.put("/settings").send({ merchantDeductions: [] });
    expect(await net()).toBe(100);
  });

  it("what-if fees are admin-only", async () => {
    const refs = await seedRefs();
    const admin = await loginAs("admin");
    const employee = await loginAs("employee");
    const order = await deliver(admin, refs);
    expect((await admin.post("/reports/settlement").send({ orderIds: [order._id], courierFee: 99 })).body.data.money.courierCommission).toBe(99);
    expect((await employee.post("/reports/settlement").send({ orderIds: [order._id], courierFee: 99 })).body.data.money.courierCommission).toBe(20);
  });
});

describe("timezone-aware dates", () => {
  it("date filters use the tenant's day, not UTC", async () => {
    const refs = await seedRefs();
    const admin = await loginAs("admin");
    const order = (await admin.post("/orders").send(orderInput(refs.merchant))).body.data;
    // 23:30 UTC on Jan 14 = 01:30 on Jan 15 in Cairo.
    await Order.collection.updateOne({ _id: new (await import("mongoose")).default.Types.ObjectId(order._id) }, { $set: { createdAt: new Date("2026-01-14T23:30:00Z") } });

    const count = async (date: string) => (await admin.get("/orders").query({ date })).body.meta.total;
    expect(await count("2026-01-15")).toBe(1);
    expect(await count("2026-01-14")).toBe(0);

    await admin.put("/settings").send({ timezone: "UTC" });
    expect(await count("2026-01-14")).toBe(1);
  });
});
