import { beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app";
import { User, Role } from "../src/models/User";
import { Tenant, TenantDoc } from "../src/models/Tenant";
import { Courier } from "../src/models/Courier";
import { Merchant } from "../src/models/Merchant";
import { PlatformAdmin } from "../src/models/PlatformAdmin";
import { hashPassword } from "../src/lib/password";

export { UNSCOPED } from "../src/lib/tenantPlugin";

export const app = createApp();
export const PASSWORD = "Str0ngPassw0rd";

let defaultTenant: TenantDoc | null = null;

// One in-memory MongoDB per test file, wiped before each test.
export function useDb() {
  let server: MongoMemoryServer;
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  });
  beforeEach(async () => {
    defaultTenant = null;
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });
}

let slugCounter = 0;
export const createTenant = (name = "Acme Shipping", extra: Record<string, unknown> = {}) =>
  Tenant.create({ name, slug: `t-${++slugCounter}`, plan: "pro", status: "active", ...extra });

// The tenant used when a test doesn't care which one.
export const getTenant = async () => (defaultTenant ||= await createTenant());

export async function createUser(role: Role, email = `${role}@test.com`, tenant?: TenantDoc, password = PASSWORD) {
  const t = tenant ?? (await getTenant());
  return User.create({ tenantId: t._id, email, role, password: await hashPassword(password) });
}

// A supertest agent that keeps cookies, already logged in.
export async function loginAs(role: Role, email = `${role}@test.com`, tenant?: TenantDoc) {
  if (!(await User.exists({ email }).setOptions({ skipTenantCheck: true }))) await createUser(role, email, tenant);
  const agent = request.agent(app);
  const res = await agent.post("/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

export async function seedRefs(tenant?: TenantDoc) {
  const t = tenant ?? (await getTenant());
  const [courier, merchant] = await Promise.all([
    Courier.create({ tenantId: t._id, name: "Ali" }),
    Merchant.create({ tenantId: t._id, name: "Acme" }),
  ]);
  return { courier: courier._id.toString(), merchant: merchant._id.toString() };
}

export async function loginPlatform(email = "root@platform.test") {
  await PlatformAdmin.create({ email, password: await hashPassword(PASSWORD) });
  const agent = request.agent(app);
  const res = await agent.post("/platform/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`platform login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

export const orderInput = (merchant: string, extra: Record<string, unknown> = {}) => ({
  fullName: "Customer",
  phone: "01001234567",
  address: "Cairo",
  cost: 100,
  merchant,
  ...extra,
});
