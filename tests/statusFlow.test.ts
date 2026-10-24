import { describe, it, expect, vi } from "vitest";
import { useDb, loginAs, seedRefs, orderInput } from "./helpers";
import { canTransition, ORDER_STATUSES } from "../src/domain/orderStatus";
import { archiveOrders } from "../src/jobs/archiveOrders";
import { Order } from "../src/models/Order";
import { updateOrder } from "../src/services/orders";

useDb();

describe("transition table", () => {
  it("closed orders are final for employees", () => {
    for (const to of ORDER_STATUSES) {
      expect(canTransition("delivered", to, "employee")).toBe(false);
    }
    expect(canTransition("delivered", "with_courier", "admin")).toBe(true);
  });

  it("orders must go through a courier", () => {
    expect(canTransition("pending", "delivered", "admin")).toBe(false);
    expect(canTransition("pending", "with_courier", "employee")).toBe(true);
  });
});

async function setup() {
  const refs = await seedRefs();
  const admin = await loginAs("admin");
  const employee = await loginAs("employee");
  const create = async () => (await employee.post("/orders").send(orderInput(refs.merchant))).body.data;
  return { refs, admin, employee, create };
}

describe("status flow over the API", () => {
  it("rejects skipping the courier step", async () => {
    const { employee, create } = await setup();
    const order = await create();
    const res = await employee.patch(`/orders/${order._id}`).send({ status: "delivered" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_STATUS_TRANSITION", details: { from: "pending", allowed: ["with_courier"] } });
  });

  it("requires a courier for with_courier", async () => {
    const { employee, create } = await setup();
    const order = await create();
    expect((await employee.patch(`/orders/${order._id}`).send({ status: "with_courier" })).status).toBe(400);
  });

  it("goes pending → with_courier → delivered and stamps deliveredAt", async () => {
    const { employee, create, refs } = await setup();
    const order = await create();

    const assigned = await employee.post("/orders/bulk/assign").send({ orderIds: [order._id], courier: refs.courier });
    expect(assigned.body.data).toEqual({ requested: 1, updated: 1, conflicts: 0 });

    const delivered = await employee.patch(`/orders/${order._id}`).send({ status: "delivered" });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.deliveredAt).toBeTruthy();
  });

  it("only admins can reopen a closed order, which clears deliveredAt", async () => {
    const { admin, employee, create, refs } = await setup();
    const order = await create();
    await employee.patch(`/orders/${order._id}`).send({ courier: refs.courier, status: "with_courier" });
    await employee.patch(`/orders/${order._id}`).send({ status: "returned" });

    expect((await employee.patch(`/orders/${order._id}`).send({ status: "pending" })).status).toBe(409);
    const reopened = await admin.patch(`/orders/${order._id}`).send({ status: "pending" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data).toMatchObject({ status: "pending", deliveredAt: null, courier: null });
  });

  it("bulk assign only takes pending orders and changes nothing if one fails", async () => {
    const { employee, create, refs } = await setup();
    const a = await create();
    const b = await create();
    await employee.patch(`/orders/${b._id}`).send({ courier: refs.courier, status: "with_courier" });
    await employee.patch(`/orders/${b._id}`).send({ status: "delivered" });

    const res = await employee.post("/orders/bulk/assign").send({ orderIds: [a._id, b._id], courier: refs.courier });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toHaveLength(1);
    expect((await Order.findById(a._id))!.status).toBe("pending");
  });

  it("bulk status saves a courier's batch in one call", async () => {
    const { employee, create, refs } = await setup();
    const orders = [await create(), await create(), await create()];
    await employee.post("/orders/bulk/assign").send({ orderIds: orders.map((o) => o._id), courier: refs.courier });

    const res = await employee.post("/orders/bulk/status").send({
      updates: [
        { id: orders[0]._id, status: "delivered" },
        { id: orders[1]._id, status: "returned" },
        { id: orders[2]._id, status: "refused" },
      ],
    });
    expect(res.body.data).toEqual({ requested: 3, updated: 3, conflicts: 0 });
    expect((await Order.find({ deliveredAt: { $ne: null } })).length).toBe(3);
  });

  it("rejects a save based on a stale read (409 CONFLICT)", async () => {
    const { create } = await setup();
    const order = await create();

    // Request A reads the order…
    const stale = await Order.findById(order._id);
    // …request B saves in between…
    await new Promise((r) => setTimeout(r, 5));
    await Order.updateOne({ _id: order._id }, { $set: { description: "saved by B" } });
    // …then A tries to save based on what it read.
    vi.spyOn(Order, "findOne").mockResolvedValueOnce(stale as never);
    const req = { user: { id: "64b000000000000000000001", email: "admin@test.com", role: "admin" } } as never;

    await expect(updateOrder(req, order._id, { cost: 1 })).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect((await Order.findById(order._id))!.cost).toBe(100);
  });

  it("archives closed orders 3 days after they were closed", async () => {
    const { employee, create, refs } = await setup();
    const order = await create();
    await employee.patch(`/orders/${order._id}`).send({ courier: refs.courier, status: "with_courier" });
    await employee.patch(`/orders/${order._id}`).send({ status: "delivered" });

    expect(await archiveOrders(new Date(Date.now() + 2 * 86400e3))).toBe(0);
    expect(await archiveOrders(new Date(Date.now() + 4 * 86400e3))).toBe(1);

    // Archived orders are read-only for employees.
    const res = await employee.patch(`/orders/${order._id}`).send({ description: "late note" });
    expect(res.status).toBe(403);
  });
});
