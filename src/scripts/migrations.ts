import mongoose from "mongoose";

type Db = mongoose.mongo.Db;
import { hashPassword, isBcryptHash } from "../lib/password";

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
];
