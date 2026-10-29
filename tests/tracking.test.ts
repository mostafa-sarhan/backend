import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, useDb, loginAs, seedRefs, orderInput, getTenant } from "./helpers";
import { Tenant } from "../src/modules/tenants/tenant.model";
import { TRACKING_ID_PATTERN } from "../src/modules/orders/order.model";

useDb();

async function setup() {
  const refs = await seedRefs();
  const admin = await loginAs("admin");
  const order = (await admin.post("/orders").send(orderInput(refs.merchant, { fullName: "Secret Name", phone: "01009998887", address: "Hidden St", description: "gate code 1234" }))).body.data;
  return { refs, admin, order };
}

describe("status timeline", () => {
  it("records every status change with who made it", async () => {
    const { admin, order, refs } = await setup();
    await admin.post("/orders/bulk/assign").send({ orderIds: [order._id], courier: refs.courier });
    await admin.patch(`/orders/${order._id}`).send({ status: "refused", reason: "Wrong address" });
    await admin.patch(`/orders/${order._id}`).send({ status: "pending" }); // admin correction
    await admin.patch(`/orders/${order._id}`).send({ description: "no status change" });

    const timeline = (await admin.get(`/orders/${order._id}`)).body.data.statusHistory;
    expect(timeline.map((e: { status: string }) => e.status)).toEqual(["pending", "with_courier", "refused", "pending"]);
    expect(timeline[2]).toMatchObject({ reason: "Wrong address", by: { email: "admin@test.com", role: "admin" } });
    expect(new Date(timeline[3].at).getTime()).toBeGreaterThanOrEqual(new Date(timeline[2].at).getTime());
  });

  it("is not sent in order lists", async () => {
    const { admin } = await setup();
    expect((await admin.get("/orders")).body.data[0]).not.toHaveProperty("statusHistory");
  });

  it("merchant API orders start the timeline too and return a trackingId", async () => {
    const admin = await loginAs("admin");
    const key = (await admin.post("/merchants").send({ name: "Shop" })).body.data.apiKey;
    const res = await request(app).post("/merchants/order").set("api-key", key).send({ fullName: "C", phone: "01001234567", address: "x", cost: 1 });
    expect(res.body.data.trackingId).toMatch(TRACKING_ID_PATTERN);
    expect((await admin.get(`/orders/${res.body.data.id}`)).body.data.statusHistory[0]).toMatchObject({ status: "pending", by: { role: "merchant_api" } });
  });
});

describe("public tracking", () => {
  it("returns the timeline and company name only", async () => {
    const { admin, order, refs } = await setup();
    expect(order.trackingId).toMatch(TRACKING_ID_PATTERN);
    await admin.post("/orders/bulk/assign").send({ orderIds: [order._id], courier: refs.courier });

    const res = await request(app).get(`/track/${order.trackingId}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data).toEqual({
      trackingId: order.trackingId,
      status: "with_courier",
      updatedAt: expect.any(String),
      timeline: [
        { status: "pending", at: expect.any(String) },
        { status: "with_courier", at: expect.any(String) },
      ],
      company: { name: "Acme Shipping", logoUrl: null },
    });
    const body = JSON.stringify(res.body);
    for (const secret of ["Secret Name", "01009998887", "Hidden St", "gate code", order.barcode, "admin@test.com", "Ali"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("works with lowercase ids, uses the label name when set", async () => {
    const { admin, order } = await setup();
    await admin.put("/settings").send({ labelName: "Acme Express" });
    const res = await request(app).get(`/track/${order.trackingId.toLowerCase()}`);
    expect(res.body.data.company.name).toBe("Acme Express");
  });

  it("unknown, malformed and barcode lookups all give the same 404", async () => {
    const { order } = await setup();
    const unknown = await request(app).get("/track/ABCDEFGHJKMNPQRSTUVW");
    const malformed = await request(app).get("/track/not-a-real-id!");
    const byBarcode = await request(app).get(`/track/${order.barcode}`);
    for (const res of [unknown, malformed, byBarcode]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "NOT_FOUND", message: "Shipment not found" });
    }
  });

  it("hides orders of suspended tenants", async () => {
    const { order } = await setup();
    await Tenant.updateOne({ _id: (await getTenant())._id }, { status: "suspended" });
    expect((await request(app).get(`/track/${order.trackingId}`)).status).toBe(404);
  });

  it("tracking ids are long and random", async () => {
    const refs = await seedRefs();
    const admin = await loginAs("admin");
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) ids.add((await admin.post("/orders").send(orderInput(refs.merchant))).body.data.trackingId);
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[A-Z2-9]{20}$/);
  });
});
