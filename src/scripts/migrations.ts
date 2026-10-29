import mongoose from "mongoose";

type Db = mongoose.mongo.Db;
import { hashPassword, isBcryptHash } from "../modules/auth/password";
import { LEGACY_STATUS_MAP } from "../modules/orders/orderStatus";
import { hashApiKey } from "../modules/merchants/apiKeys";
import { generateTrackingId } from "../modules/orders/order.model";
import { Order } from "../modules/orders/order.model";
import { Courier } from "../modules/couriers/courier.model";
import { Merchant } from "../modules/merchants/merchant.model";
import { User } from "../modules/users/user.model";
import { RefreshToken } from "../modules/auth/refreshToken.model";
import { AuditEvent } from "../modules/audit/auditEvent.model";
import { Tenant } from "../modules/tenants/tenant.model";
import { PlatformAdmin } from "../modules/platform/platformAdmin.model";
import { PlatformAuditEvent } from "../modules/platform/platformAuditEvent.model";
import { AccessRequest } from "../modules/platform/accessRequest.model";

export interface Migration {
  name: string;
  run(db: Db): Promise<Record<string, number>>;
}

export const migrations: Migration[] = [
  {
    // Emails are matched lowercase now.
    name: "lowercase-user-emails",
    async run(db) {
      let updated = 0;
      for await (const u of db.collection("users").find({}, { projection: { email: 1 } })) {
        const email = String(u.email).trim().toLowerCase();
        if (email !== u.email) {
          await db.collection("users").updateOne({ _id: u._id }, { $set: { email } });
          updated++;
        }
      }
      return { updated };
    },
  },
  {
    // Plain-text passwords -> bcrypt (cost 12). The login no longer accepts plain text.
    name: "hash-plaintext-passwords",
    async run(db) {
      let hashed = 0;
      for await (const u of db.collection("users").find({}, { projection: { password: 1 } })) {
        if (typeof u.password === "string" && !isBcryptHash(u.password)) {
          await db.collection("users").updateOne({ _id: u._id }, { $set: { password: await hashPassword(u.password) } });
          hashed++;
        }
      }
      await db.collection("users").updateMany({ tokenVersion: { $exists: false } }, { $set: { tokenVersion: 0 } });
      return { hashed };
    },
  },
  {
    // Old per-user audit log -> generic audit events.
    name: "copy-legacy-audit-logs",
    async run(db) {
      const legacy = db.collection("auditlogs");
      const events = db.collection("auditevents");
      let copied = 0;
      for await (const log of legacy.find({ migratedAt: { $exists: false } })) {
        const user = await db.collection("users").findOne({ email: String(log.targetUser).toLowerCase() }, { projection: { _id: 1 } });
        await events.insertOne({
          entity: "user",
          entityId: user?._id ?? log._id,
          action: log.action,
          label: log.targetUser,
          actor: { email: log.changedBy },
          changes: log.action === "CHANGE_PASSWORD" ? undefined : { role: { from: log.oldValue ?? null, to: log.newValue ?? null } },
          createdAt: log.createdAt,
        });
        await legacy.updateOne({ _id: log._id }, { $set: { migratedAt: new Date() } });
        copied++;
      }
      return { copied };
    },
  },
  {
    // Arabic status strings -> English codes.
    name: "order-status-codes",
    async run(db) {
      let updated = 0;
      for (const [label, code] of Object.entries(LEGACY_STATUS_MAP)) {
        updated += (await db.collection("orders").updateMany({ status: label }, { $set: { status: code } })).modifiedCount;
      }
      return { updated };
    },
  },
  {
    // Courier and company names -> ObjectId references (couriers live in "deliveries", companies are merchants).
    name: "order-refs-to-ids",
    async run(db) {
      const orders = db.collection("orders");
      const stats = { couriersCreated: 0, merchantsCreated: 0, ordersLinked: 0 };

      const findOrCreate = async (collection: string, name: string, counter: "couriersCreated" | "merchantsCreated") => {
        const existing = await db.collection(collection).findOne({ name });
        if (existing) return existing._id;
        stats[counter]++;
        const now = new Date();
        return (await db.collection(collection).insertOne({ name, createdAt: now, updatedAt: now })).insertedId;
      };

      const courierNames = (await orders.distinct("delivery", { delivery: { $type: "string" } })) as string[];
      for (const raw of courierNames) {
        const name = raw.trim();
        const id = !name || name === "لم يحدد" ? null : await findOrCreate("deliveries", name, "couriersCreated");
        stats.ordersLinked += (await orders.updateMany({ delivery: raw }, { $set: { courier: id }, $unset: { delivery: "" } })).modifiedCount;
      }

      const companyNames = (await orders.distinct("company", { company: { $type: "string" } })) as string[];
      for (const raw of companyNames) {
        const name = raw.trim();
        if (name) {
          const id = await findOrCreate("merchants", name, "merchantsCreated");
          // Merchant-API orders already carry a merchant id; keep it.
          await orders.updateMany({ company: raw, merchant: { $exists: false } }, { $set: { merchant: id } });
        }
        stats.ordersLinked += (await orders.updateMany({ company: raw }, { $unset: { company: "" } })).modifiedCount;
      }

      await orders.updateMany({ courier: { $exists: false } }, { $set: { courier: null } });
      await orders.updateMany({ deliveredAt: { $exists: false } }, { $set: { deliveredAt: null } });
      return stats;
    },
  },
  {
    // Plain-text merchant API keys -> SHA-256 hash + prefix. Existing integrations keep their key.
    name: "hash-merchant-api-keys",
    async run(db) {
      let hashed = 0;
      for await (const m of db.collection("merchants").find({ apiKey: { $type: "string" } })) {
        await db.collection("merchants").updateOne(
          { _id: m._id },
          {
            $set: { apiKeyHash: hashApiKey(m.apiKey), apiKeyPrefix: String(m.apiKey).slice(0, 10), apiKeyCreatedAt: m.createdAt ?? new Date() },
            $unset: { apiKey: "" },
          }
        );
        hashed++;
      }
      return { hashed };
    },
  },
  {
    // Phase C: existing single-company data becomes the first tenant (active, unlimited plan).
    // The oldest admin becomes its owner. Old refresh tokens (pre-realm) are dropped: users log in again.
    name: "default-tenant",
    async run(db) {
      const collections = ["users", "orders", "deliveries", "merchants", "auditevents"];
      const untenanted = async () => {
        let n = 0;
        for (const c of collections) n += await db.collection(c).countDocuments({ tenantId: { $exists: false } });
        return n;
      };
      if (!(await untenanted())) return { assigned: 0, droppedTokens: 0 };

      const tenants = db.collection("tenants");
      let tenant = await tenants.findOne({ slug: "default" });
      if (!tenant) {
        const now = new Date();
        const doc = {
          name: process.env.DEFAULT_TENANT_NAME || "Default company",
          slug: "default",
          plan: "pro",
          status: "active",
          trialEndsAt: null,
          limits: { maxUsers: null, maxOrdersPerMonth: null },
          settings: {
            fees: { courier: Number(process.env.DEFAULT_COURIER_FEE ?? 20), company: Number(process.env.DEFAULT_COMPANY_FEE ?? 20) },
            merchantDeductions: ["company"],
            archiveAfterDays: 3,
            timezone: "Africa/Cairo",
            currency: "EGP",
          },
          createdAt: now,
          updatedAt: now,
        };
        tenant = { _id: (await tenants.insertOne(doc)).insertedId, ...doc };
      }

      let assigned = 0;
      for (const c of collections) {
        assigned += (await db.collection(c).updateMany({ tenantId: { $exists: false } }, { $set: { tenantId: tenant._id } })).modifiedCount;
      }

      const users = db.collection("users");
      if (!(await users.countDocuments({ tenantId: tenant._id, role: "owner" }))) {
        const first = await users.find({ tenantId: tenant._id, role: "admin" }).sort({ createdAt: 1, _id: 1 }).limit(1).next();
        if (first) await users.updateOne({ _id: first._id }, { $set: { role: "owner" } });
      }
      const droppedTokens = (await db.collection("refreshtokens").deleteMany({ realm: { $exists: false } })).deletedCount;
      return { assigned, droppedTokens };
    },
  },
  {
    // Phase C (b): delivered orders get a fee snapshot from their tenant's settings
    // (and the merchant's company-fee override), so reports stop depending on current fees.
    name: "snapshot-delivered-fees",
    async run(db) {
      let snapshotted = 0;
      for await (const t of db.collection("tenants").find({}, { projection: { settings: 1 } })) {
        const courier = t.settings?.fees?.courier ?? 20;
        const company = t.settings?.fees?.company ?? 20;
        const overrides = await db.collection("merchants").find({ tenantId: t._id, companyFee: { $type: "number" } }).toArray();
        for (const m of overrides) {
          snapshotted += (await db.collection("orders").updateMany({ tenantId: t._id, merchant: m._id, status: "delivered", fees: null }, { $set: { fees: { courier, company: m.companyFee } } })).modifiedCount;
        }
        snapshotted += (await db.collection("orders").updateMany({ tenantId: t._id, status: "delivered", fees: null }, { $set: { fees: { courier, company } } })).modifiedCount;
      }
      return { snapshotted };
    },
  },
  {
    // Phase C (d): public tracking ids and the status timeline for existing orders.
    // The timeline is rebuilt from the audit log where possible, else from the current status.
    name: "tracking-ids-and-timeline",
    async run(db) {
      const orders = db.collection("orders");
      let tracking = 0;
      let timelines = 0;
      for await (const o of orders.find({ $or: [{ trackingId: { $exists: false } }, { statusHistory: { $exists: false } }] })) {
        const set: Record<string, unknown> = {};
        if (!o.trackingId) {
          let id = generateTrackingId();
          while (await orders.findOne({ trackingId: id }, { projection: { _id: 1 } })) id = generateTrackingId();
          set.trackingId = id;
          tracking++;
        }
        if (!o.statusHistory) {
          const events = await db.collection("auditevents").find({ tenantId: o.tenantId, entity: "order", entityId: o._id, "changes.status": { $exists: true } }).sort({ createdAt: 1 }).toArray();
          set.statusHistory = events.length
            ? events.map((e) => ({ status: e.changes.status.to, at: e.createdAt, by: { id: e.actor?.id, email: e.actor?.email } }))
            : [{ status: o.status, at: o.updatedAt ?? o.createdAt ?? new Date() }];
          timelines++;
        }
        await orders.updateOne({ _id: o._id }, { $set: set });
      }
      return { tracking, timelines };
    },
  },
  {
    // Create the indexes declared in the schemas and drop ones that are no longer declared.
    name: "sync-indexes",
    async run() {
      for (const model of [Tenant, Order, Courier, Merchant, User, RefreshToken, AuditEvent, PlatformAdmin, PlatformAuditEvent, AccessRequest]) {
        await model.syncIndexes();
      }
      return {};
    },
  },
];
