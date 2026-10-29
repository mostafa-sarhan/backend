import mongoose from "mongoose";

// Operations inside withTransaction() join the session automatically (AsyncLocalStorage),
// so services don't pass sessions around. Requires a replica set (Atlas, or `mongod --replSet`).
mongoose.set("transactionAsyncLocalStorage", true);

export const withTransaction = <T>(fn: () => Promise<T>): Promise<T> =>
  mongoose.connection.transaction(fn) as Promise<T>;
