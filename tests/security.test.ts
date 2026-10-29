import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app, useDb, loginAs, loginPlatform, seedRefs, orderInput, PASSWORD, UNSCOPED } from "./helpers";
import { Order } from "../src/modules/orders/order.model";
import { AuditEvent } from "../src/modules/audit/auditEvent.model";
import { AccessRequest } from "../src/modules/platform/accessRequest.model";
import { User } from "../src/modules/users/user.model";

useDb();

describe("forced password change", () => {
  it("users created by an admin must change the one-time password before using the app", async () => {
    const admin = await loginAs("admin");
    await admin.post("/users").send({ email: "new@test.com", password: "OneT1mePassword", role: "employee" });

    const user = request.agent(app);
    const login = await user.post("/auth/login").send({ email: "new@test.com", password: "OneT1mePassword" });
    expect(login.body.data.user.mustChangePassword).toBe(true);
    expect((await user.get("/orders")).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await user.get("/auth/me")).body.data.user.mustChangePassword).toBe(true);

    expect((await user.post("/auth/change-password").send({ currentPassword: "OneT1mePassword", newPassword: "OneT1mePassword" })).status).toBe(400);
    expect((await user.post("/auth/change-password").send({ currentPassword: "OneT1mePassword", newPassword: "MyOwnPassw0rd" })).status).toBe(200);
    expect((await user.get("/orders")).status).toBe(200);
  });

  it("an admin password reset makes it a one-time password again", async () => {
    const admin = await loginAs("admin");
    await loginAs("employee");
    const target = await User.findOne({ email: "employee@test.com" }).setOptions(UNSCOPED);
    await admin.put(`/users/${target!.id}/password`).send({ newPassword: "ResetPassw0rd!" });
    const user = request.agent(app);
    await user.post("/auth/login").send({ email: "employee@test.com", password: "ResetPassw0rd!" });
    expect((await user.get("/orders")).status).toBe(403);
  });

  it("tenant owners created by the platform must change it too", async () => {
    const platform = await loginPlatform();
    const { initialPassword } = (await platform.post("/platform/tenants").send({ name: "New", ownerEmail: "o@new.test" })).body.data;
    const owner = request.agent(app);
    await owner.post("/auth/login").send({ email: "o@new.test", password: initialPassword });
    expect((await owner.get("/users")).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });
});

describe("transactions", () => {
  it("a bulk status change with one stale order rolls back entirely, audit included", async () => {
    const refs = await seedRefs();
    const admin = await loginAs("admin");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await admin.post("/orders").send(orderInput(refs.merchant, { courier: refs.courier }))).body.data._id);

    const stale = await Order.find({ _id: { $in: ids } }).setOptions(UNSCOPED);
    await new Promise((r) => setTimeout(r, 5));
    await Order.updateOne({ _id: ids[2] }, { $set: { description: "edited meanwhile" } }).setOptions(UNSCOPED);
    vi.spyOn(Order, "find").mockResolvedValueOnce(stale as never);
    const auditBefore = await AuditEvent.countDocuments().setOptions(UNSCOPED);

    const res = await admin.post("/orders/bulk/status").send({ updates: ids.map((id) => ({ id, status: "delivered" })) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
    const statuses = (await Order.find({ _id: { $in: ids } }).setOptions(UNSCOPED)).map((o) => o.status);
    expect(statuses).toEqual(["with_courier", "with_courier", "with_courier"]);
    expect(await AuditEvent.countDocuments().setOptions(UNSCOPED)).toBe(auditBefore);
  });
});

describe("request limits", () => {
  it("rejects oversized JSON bodies", async () => {
    const admin = await loginAs("admin");
    const res = await admin.post("/orders").set("Content-Type", "application/json").send(JSON.stringify({ fullName: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("access-request honeypot: bots get a 201 and nothing is stored", async () => {
    const res = await request(app).post("/access-requests").send({ companyName: "Bot Co", contactName: "Bot", phone: "01001112222", email: "bot@x.test", website: "http://spam" });
    expect(res.status).toBe(201);
    expect(await AccessRequest.countDocuments()).toBe(0);
  });

  void PASSWORD;
});
