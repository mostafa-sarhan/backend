import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app, useDb, createUser, loginAs, PASSWORD, getTenant, UNSCOPED } from "./helpers";
import { User } from "../src/modules/users/user.model";

useDb();

const cookies = (res: request.Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);
const refreshCookie = (res: request.Response) => cookies(res).find((c) => c.startsWith("refresh_token="))!.split(";")[0];

describe("login", () => {
  it("sets httpOnly SameSite cookies and returns no token in the body", async () => {
    await createUser("admin");
    const res = await request(app).post("/auth/login").send({ email: "ADMIN@test.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: "admin@test.com", role: "admin" });
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    const access = cookies(res).find((c) => c.startsWith("access_token="))!;
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Strict/);
    expect(refreshCookie(res)).toBeTruthy();
  });

  it("gives the same error for wrong password and unknown email", async () => {
    await createUser("admin");
    const wrong = await request(app).post("/auth/login").send({ email: "admin@test.com", password: "nope" });
    const unknown = await request(app).post("/auth/login").send({ email: "who@test.com", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.body.error).toMatchObject({ code: wrong.body.error.code, message: wrong.body.error.message });
  });

  it("no longer accepts plain-text passwords stored in the DB", async () => {
    await User.collection.insertOne({ tenantId: (await getTenant())._id, email: "old@test.com", password: "plain123", role: "admin", tokenVersion: 0 });
    const res = await request(app).post("/auth/login").send({ email: "old@test.com", password: "plain123" });
    expect(res.status).toBe(401);
  });

  it("rejects operator objects instead of passing them to MongoDB", async () => {
    const res = await request(app).post("/auth/login").send({ email: { $ne: null }, password: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("access token", () => {
  it("is required for protected routes", async () => {
    const res = await request(app).get("/orders");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("is ignored in an Authorization header (cookies only)", async () => {
    const user = await createUser("admin");
    const token = jwt.sign({ role: "admin", tv: 0, tid: user.tenantId.toString() }, "test-secret", { subject: user.id, issuer: "shipping-api", audience: "tenant" });
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("must be HS256: alg=none and other secrets are rejected", async () => {
    const user = await createUser("admin");
    const claims = { role: "admin", tv: 0, tid: user.tenantId.toString() };
    const opts = { subject: user.id, issuer: "shipping-api", audience: "tenant" };
    const none = jwt.sign(claims, "", { ...opts, algorithm: "none" });
    const other = jwt.sign(claims, "wrong", { ...opts, algorithm: "HS256" });
    for (const token of [none, other]) {
      const res = await request(app).get("/auth/me").set("Cookie", `access_token=${token}`);
      expect(res.status).toBe(401);
    }
  });
});

describe("refresh + revocation", () => {
  it("rotates the refresh token and treats reuse as theft", async () => {
    await createUser("admin");
    const login = await request(app).post("/auth/login").send({ email: "admin@test.com", password: PASSWORD });
    const first = refreshCookie(login);

    const refreshed = await request(app).post("/auth/refresh").set("Cookie", first);
    expect(refreshed.status).toBe(200);
    const second = refreshCookie(refreshed);
    expect(second).not.toBe(first);

    // Replaying the old token after the grace window revokes everything, including the new token.
    vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ["Date"] });
    try {
      expect((await request(app).post("/auth/refresh").set("Cookie", first)).status).toBe(401);
      expect((await request(app).post("/auth/refresh").set("Cookie", second)).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tolerates concurrent refreshes with the same token (two tabs, reload)", async () => {
    await createUser("admin");
    const login = await request(app).post("/auth/login").send({ email: "admin@test.com", password: PASSWORD });
    const token = refreshCookie(login);

    const [a, b] = [await request(app).post("/auth/refresh").set("Cookie", token), await request(app).post("/auth/refresh").set("Cookie", token)];
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await request(app).post("/auth/refresh").set("Cookie", refreshCookie(a))).status).toBe(200);
  });

  it("logout revokes the refresh token", async () => {
    await createUser("admin");
    const login = await request(app).post("/auth/login").send({ email: "admin@test.com", password: PASSWORD });
    await request(app).post("/auth/logout").set("Cookie", refreshCookie(login));
    expect((await request(app).post("/auth/refresh").set("Cookie", refreshCookie(login))).status).toBe(401);
  });

  it("password change logs out the user's existing sessions", async () => {
    const admin = await loginAs("admin");
    const employee = await loginAs("employee");
    const target = await User.findOne({ email: "employee@test.com" }).setOptions(UNSCOPED);

    expect((await employee.get("/auth/me")).status).toBe(200);
    const change = await admin.put(`/users/${target!.id}/password`).send({ newPassword: "An0therGoodOne" });
    expect(change.status).toBe(200);
    expect((await employee.get("/auth/me")).status).toBe(401);
  });

  it("role change logs out the user's existing sessions", async () => {
    const admin = await loginAs("admin");
    const employee = await loginAs("employee");
    const target = await User.findOne({ email: "employee@test.com" }).setOptions(UNSCOPED);

    await admin.put(`/users/${target!.id}/role`).send({ role: "admin" });
    expect((await employee.get("/auth/me")).status).toBe(401);
  });
});

describe("users", () => {
  it("enforces the password policy", async () => {
    const admin = await loginAs("admin");
    const res = await admin.post("/users").send({ email: "new@test.com", password: "short", role: "employee" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEAK_PASSWORD");
  });

  it("stores bcrypt cost 12", async () => {
    const admin = await loginAs("admin");
    await admin.post("/users").send({ email: "new@test.com", password: "G00dPassword!", role: "employee" });
    const user = await User.findOne({ email: "new@test.com" }).setOptions(UNSCOPED);
    expect(user!.password).toMatch(/^\$2[aby]\$12\$/);
  });

  it("rejects roles other than admin/employee", async () => {
    const admin = await loginAs("admin");
    const res = await admin.post("/users").send({ email: "new@test.com", password: "G00dPassword!", role: "user" });
    expect(res.status).toBe(400);
  });

  it("won't let an admin demote themselves or the last admin", async () => {
    const admin = await loginAs("admin");
    const me = await User.findOne({ email: "admin@test.com" }).setOptions(UNSCOPED);
    const res = await admin.put(`/users/${me!.id}/role`).send({ role: "employee" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
  });
});

describe("CSRF origin check", () => {
  it("blocks state-changing requests from other origins", async () => {
    const res = await request(app).post("/auth/login").set("Origin", "https://evil.example").send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
  });
});
