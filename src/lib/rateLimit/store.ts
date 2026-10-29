import mongoose from "mongoose";

// Fixed-window counters shared by all limiters and the login lockout.
// memory (default, one process) | redis (REDIS_URL) | mongo (RATE_LIMIT_STORE=mongo) for several processes.
export interface Counter {
  count: number;
  resetAt: Date;
}

export interface CounterStore {
  hit(key: string, windowMs: number): Promise<Counter>;
  decrement(key: string): Promise<void>;
  get(key: string): Promise<Counter | null>;
  // Start a fresh window of `ms` (used for lockouts).
  block(key: string, ms: number): Promise<void>;
  reset(key: string): Promise<void>;
}

export class MemoryStore implements CounterStore {
  private data = new Map<string, Counter>();
  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.data) if (v.resetAt.getTime() <= now) this.data.delete(k);
    }, 60_000).unref();
  }
  async hit(key: string, windowMs: number) {
    const now = Date.now();
    const current = this.data.get(key);
    const next = current && current.resetAt.getTime() > now ? { count: current.count + 1, resetAt: current.resetAt } : { count: 1, resetAt: new Date(now + windowMs) };
    this.data.set(key, next);
    return next;
  }
  async decrement(key: string) {
    const c = this.data.get(key);
    if (c && c.count > 0) c.count--;
  }
  async get(key: string) {
    const c = this.data.get(key);
    return c && c.resetAt.getTime() > Date.now() ? c : null;
  }
  async block(key: string, ms: number) {
    this.data.set(key, { count: 1, resetAt: new Date(Date.now() + ms) });
  }
  async reset(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

export class RedisStore implements CounterStore {
  private client: Promise<import("redis").RedisClientType>;
  constructor(url: string) {
    this.client = import("redis").then(async ({ createClient }) => {
      const c = createClient({ url }) as import("redis").RedisClientType;
      await c.connect();
      return c;
    });
  }
  async hit(key: string, windowMs: number) {
    const c = await this.client;
    const [count, , ttl] = (await c.multi().incr(key).pExpire(key, windowMs, "NX").pTTL(key).exec()) as unknown as [number, unknown, number];
    return { count, resetAt: new Date(Date.now() + Math.max(ttl, 0)) };
  }
  async decrement(key: string) {
    await (await this.client).decr(key);
  }
  async get(key: string) {
    const c = await this.client;
    const [count, ttl] = await Promise.all([c.get(key), c.pTTL(key)]);
    return count === null || ttl <= 0 ? null : { count: Number(count), resetAt: new Date(Date.now() + ttl) };
  }
  async block(key: string, ms: number) {
    await (await this.client).set(key, "1", { PX: ms });
  }
  async reset(key: string) {
    await (await this.client).del(key);
  }
}

// Works across processes with no extra infrastructure; expired windows are removed by a TTL index.
export class MongoStore implements CounterStore {
  private ready: Promise<unknown> | null = null;
  private get col() {
    const col = mongoose.connection.collection<{ _id: string; count: number; resetAt: Date }>("ratelimits");
    this.ready ||= col.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 });
    return col;
  }
  async hit(key: string, windowMs: number) {
    const now = new Date();
    const doc = await this.col.findOneAndUpdate(
      { _id: key },
      [
        {
          $set: {
            count: { $cond: [{ $gt: ["$resetAt", now] }, { $add: ["$count", 1] }, 1] },
            resetAt: { $cond: [{ $gt: ["$resetAt", now] }, "$resetAt", new Date(now.getTime() + windowMs)] },
          },
        },
      ],
      { upsert: true, returnDocument: "after" }
    );
    return { count: doc!.count, resetAt: doc!.resetAt };
  }
  async decrement(key: string) {
    await this.col.updateOne({ _id: key, count: { $gt: 0 } }, { $inc: { count: -1 } });
  }
  async get(key: string) {
    const doc = await this.col.findOne({ _id: key });
    return doc && doc.resetAt > new Date() ? { count: doc.count, resetAt: doc.resetAt } : null;
  }
  async block(key: string, ms: number) {
    await this.col.updateOne({ _id: key }, { $set: { count: 1, resetAt: new Date(Date.now() + ms) } }, { upsert: true });
  }
  async reset(key: string) {
    await this.col.deleteOne({ _id: key });
  }
}

export function createStore(): CounterStore {
  if (process.env.REDIS_URL) return new RedisStore(process.env.REDIS_URL);
  if (process.env.RATE_LIMIT_STORE === "mongo") return new MongoStore();
  return new MemoryStore();
}
