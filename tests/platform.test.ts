import { describe, it, expect } from "vitest";
import request from "supertest";
import { app, useDb, loginAs, loginPlatform, createTenant } from "./helpers";
import { PlatformAuditEvent } from "../src/models/PlatformAuditEvent";
import { AccessRequest } from "../src/models/AccessRequest";

useDb();

const requestBody = { companyName: "Speedy Delivery", contactName: "Mona", phone: "01001112222", email: "mona@speedy.test" };

describe("platform admin", () => {
  it("has its own session that tenant routes don't accept, and vice versa", async () => {
    const platform = await loginPlatform();
    expect((await platform.get("/platform/tenants")).status).toBe(200);
    expect((await platform.get("/orders")).status).toBe(401);
    expect((await platform.get("/auth/me")).status).toBe(401);

    const tenantUser = await loginAs("owner");
    expect((await tenantUser.get("/platform/tenants")).status).toBe(401);
  });

  it("creates a tenant with an owner whose one-time password works", async () => {
    const platform = await loginPlatform();
    const res = await platform.post("/platform/tenants").send({ name: "New Co", ownerEmail: "boss@newco.test" });
    expect(res.status).toBe(201);
    expect(res.body.data.tenant).toMatchObject({ plan: "trial", status: "trial", limits: { maxUsers: 3, maxOrdersPerMonth: 300 } });

    const login = await request(app).post("/auth/login").send({ email: "boss@newco.test", password: res.body.data.initialPassword });
    expect(login.status).toBe(200);
    expect(login.body.data).toMatchObject({ user: { role: "owner" }, tenant: { name: "New Co", currency: "EGP" } });
  });

  it("suspending a tenant ends its users' sessions", async () => {
    const platform = await loginPlatform();
    const tenant = await createTenant("Victim");
    const user = await loginAs("owner", "owner@victim.test", tenant);
    expect((await platform.patch(`/platform/tenants/${tenant.id}`).send({ status: "suspended" })).status).toBe(200);
    expect((await user.get("/auth/me")).status).toBe(403);

    expect((await platform.patch(`/platform/tenants/${tenant.id}`).send({ status: "active", plan: "starter" })).body.data).toMatchObject({
      status: "active",
      limits: { maxUsers: 10, maxOrdersPerMonth: 3000 },
    });
  });

  it("approves an access request into a tenant", async () => {
    const platform = await loginPlatform();
    expect((await request(app).post("/access-requests").send(requestBody)).status).toBe(201);
    const pending = (await platform.get("/platform/access-requests").query({ status: "pending" })).body.data;
    expect(pending).toHaveLength(1);

    const approved = await platform.post(`/platform/access-requests/${pending[0]._id}/approve`).send({});
    expect(approved.status).toBe(201);
    expect(approved.body.data.tenant.name).toBe("Speedy Delivery");
    expect((await platform.post(`/platform/access-requests/${pending[0]._id}/approve`).send({})).status).toBe(409);

    const login = await request(app).post("/auth/login").send({ email: requestBody.email, password: approved.body.data.initialPassword });
    expect(login.body.data.user.role).toBe("owner");
  });

  it("audits every action, reads included", async () => {
    const platform = await loginPlatform();
    await platform.get("/platform/tenants");
    await platform.post("/platform/tenants").send({ name: "Audited", ownerEmail: "o@audited.test" });
    await request(app).post("/platform/auth/login").send({ email: "root@platform.test", password: "wrong" });
    await new Promise((r) => setTimeout(r, 50)); // VIEW events are written after the response

    const actions = (await PlatformAuditEvent.find().sort({ createdAt: 1 })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["LOGIN", "VIEW", "CREATE_TENANT", "LOGIN_FAILED"]));
    const create = await PlatformAuditEvent.findOne({ action: "CREATE_TENANT" });
    expect(create).toMatchObject({ actor: { email: "root@platform.test" }, target: { type: "tenant", label: "Audited" } });
  });
});

describe("public access requests", () => {
  it("validates input and doesn't reveal duplicates", async () => {
    expect((await request(app).post("/access-requests").send({ ...requestBody, email: "nope" })).status).toBe(400);
    expect((await request(app).post("/access-requests").send({ ...requestBody, extra: 1 })).status).toBe(400);
    expect((await request(app).post("/access-requests").send(requestBody)).status).toBe(201);
    expect((await request(app).post("/access-requests").send(requestBody)).status).toBe(201);
    expect(await AccessRequest.countDocuments()).toBe(1);
  });
});
