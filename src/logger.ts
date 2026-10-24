import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: process.env.NODE_ENV === "test" ? "silent" : config.logLevel,
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]', "*.password", "*.apiKey"],
    censor: "[redacted]",
  },
  ...(config.isProd || process.env.NODE_ENV === "test" ? {} : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
});
