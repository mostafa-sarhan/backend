import mongoose from "mongoose";

// Reject query filters built from unexpected objects (e.g. {"$ne": null}) for plain lookups.
mongoose.set("strictQuery", true);

export const connectDb = (uri: string) => mongoose.connect(uri);
export const disconnectDb = () => mongoose.disconnect();
export const isDbReady = () => mongoose.connection.readyState === 1;
