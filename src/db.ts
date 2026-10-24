import mongoose from "mongoose";

// Drop filter keys that aren't in the schema. Operator injection ({"$ne": null}) is
// blocked earlier: every route parses input with zod, so filter values are plain strings.
mongoose.set("strictQuery", true);

export const connectDb = (uri: string) => mongoose.connect(uri);
export const disconnectDb = () => mongoose.disconnect();
export const isDbReady = () => mongoose.connection.readyState === 1;
