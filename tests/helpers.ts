import { beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app";
import { User, Role } from "../src/models/User";
import { Courier } from "../src/models/Courier";
import { Merchant } from "../src/models/Merchant";
import { hashPassword } from "../src/lib/password";

export const app = createApp();
export const PASSWORD = "Str0ngPassw0rd";

// One in-memory MongoDB per test file, wiped before each test.
export function useDb() {
  let server: MongoMemoryServer;
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  });
  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });
}

export async function createUser(role: Role, email = `${role}@test.com`, password = PASSWORD) {
  return User.create({ email, role, password: await hashPassword(password) });
}

// A supertest agent that keeps cookies, already logged in.
export async function loginAs(role: Role, email = `${role}@test.com`) {
  if (!(await User.exists({ email }))) await createUser(role, email);
  const agent = request.agent(app);
  const res = await agent.post("/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

export async function seedRefs() {
  const [courier, merchant] = await Promise.all([Courier.create({ name: "Ali" }), Merchant.create({ name: "Acme" })]);
  return { courier: courier._id.toString(), merchant: merchant._id.toString() };
}

export const orderInput = (merchant: string, extra: Record<string, unknown> = {}) => ({
  fullName: "Customer",
  phone: "01001234567",
  address: "Cairo",
  cost: 100,
  merchant,
  ...extra,
});
