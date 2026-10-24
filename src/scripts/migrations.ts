import mongoose from "mongoose";

type Db = mongoose.mongo.Db;
import { hashPassword, isBcryptHash } from "../lib/password";
import { LEGACY_STATUS_MAP } from "../domain/orderStatus";
import { Order } from "../models/Order";
import { Courier } from "../models/Courier";
import { Merchant } from "../models/Merchant";
import { User } from "../models/User";
import { RefreshToken } from "../models/RefreshToken";
import { AuditEvent } from "../models/AuditEvent";

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
    // Create the indexes declared in the schemas and drop ones that are no longer declared.
    name: "sync-indexes",
    async run() {
      for (const model of [Order, Courier, Merchant, User, RefreshToken, AuditEvent]) await model.syncIndexes();
      return {};
    },
  },
];
