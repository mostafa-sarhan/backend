import { describe, it, expect } from "vitest";
import { useDb, loginAs, seedRefs, orderInput } from "./helpers";
import { AuditEvent } from "../src/models/AuditEvent";

useDb();

async function setup() {
  const refs = await seedRefs();
  const admin = await loginAs("admin");
  const employee = await loginAs("employee");
  const order = (await employee.post("/orders").send(orderInput(refs.merchant))).body.data;
  return { refs, admin, employee, order };
}

describe("order permissions", () => {
  it("employees can create orders", async () => {
    const { order } = await setup();
    expect(order).toMatchObject({ status: "pending", cost: 100 });
    expect(order.barcode).toMatch(/^\d{8}$/);
  });

  it("only admins can delete orders", async () => {
    const { admin, employee, order } = await setup();
    expect((await employee.delete(`/orders/${order._id}`)).status).toBe(403);
    expect((await admin.delete(`/orders/${order._id}`)).status).toBe(200);
    expect((await admin.get(`/orders/${order._id}`)).status).toBe(404);
  });

  it("only admins can change cost and customer data", async () => {
    const { admin, employee, order } = await setup();
    const denied = await employee.patch(`/orders/${order._id}`).send({ cost: 1 });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: "FORBIDDEN_FIELDS", details: ["cost"] });

    const allowed = await admin.patch(`/orders/${order._id}`).send({ cost: 150, fullName: "Fixed" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toMatchObject({ cost: 150, fullName: "Fixed" });
  });

  it("employees can add notes and assign couriers", async () => {
    const { employee, order, refs } = await setup();
    const res = await employee.patch(`/orders/${order._id}`).send({ description: "Call first", courier: refs.courier, status: "with_courier" });
    expect(res.status).toBe(200);
    expect(res.body.data.courier).toMatchObject({ name: "Ali" });
  });

  it("server-controlled fields are never writable", async () => {
    const { admin, order, refs } = await setup();
    for (const body of [{ barcode: "99999999" }, { isArchived: true }, { deliveredAt: new Date() }, { merchantRef: "x" }]) {
      expect((await admin.patch(`/orders/${order._id}`).send(body)).status).toBe(400);
    }
    expect((await admin.post("/orders").send({ ...orderInput(refs.merchant), barcode: "12345678" })).status).toBe(400);
  });

  it("validates input instead of failing with 500", async () => {
    const { admin, refs } = await setup();
    expect((await admin.get("/orders/not-an-id")).status).toBe(400);
    expect((await admin.post("/orders").send(orderInput(refs.merchant, { cost: -5 }))).status).toBe(400);
    expect((await admin.post("/orders").send(orderInput(refs.merchant, { cost: "abc" }))).status).toBe(400);
    expect((await admin.post("/orders").send(orderInput(refs.merchant, { fullName: "x".repeat(101) }))).status).toBe(400);
    expect((await admin.post("/orders").send(orderInput("64b000000000000000000000"))).status).toBe(400);
  });

  it("export, reports, users and merchant management are admin-only", async () => {
    const { employee, admin } = await setup();
    for (const path of ["/orders/export", "/reports/summary", "/reports/merchants", "/reports/couriers", "/users", "/merchants"]) {
      expect((await employee.get(path)).status, path).toBe(403);
      expect((await admin.get(path)).status, path).toBe(200);
    }
    expect((await employee.post("/couriers").send({ name: "New" })).status).toBe(403);
  });

  it("records who changed what", async () => {
    const { admin, order } = await setup();
    await admin.patch(`/orders/${order._id}`).send({ cost: 120 });
    const history = (await admin.get(`/orders/${order._id}/history`)).body.data;
    expect(history.map((e: { action: string }) => e.action)).toEqual(["CREATE", "UPDATE"]);
    expect(history[1]).toMatchObject({ actor: { email: "admin@test.com" }, changes: { cost: { from: 100, to: 120 } } });

    await admin.delete(`/orders/${order._id}`);
    expect(await AuditEvent.countDocuments({ entityId: order._id, action: "DELETE" })).toBe(1);
  });

  it("uses one response shape for success and errors", async () => {
    const { admin } = await setup();
    const list = await admin.get("/orders");
    expect(list.body).toEqual({ data: expect.any(Array), meta: expect.objectContaining({ total: 1, page: 1 }) });
    const missing = await admin.get("/orders/64b000000000000000000000");
    expect(missing.body).toEqual({ error: { code: "NOT_FOUND", message: "Order not found", requestId: expect.any(String) } });
  });
});
