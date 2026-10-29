import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { config } from "./config";
import { logger } from "./logger";
import { isDbReady } from "./db";
import { AppError, errorHandler, notFoundHandler } from "./lib/errors";
import { originCheck } from "./middleware/csrf";

import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import orderRoutes from "./routes/orders";
import courierRoutes from "./routes/couriers";
import merchantRoutes from "./routes/merchants";
import reportRoutes from "./routes/reports";
import platformRoutes from "./routes/platform";
import accessRequestRoutes from "./routes/accessRequests";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1); // correct client IPs behind a reverse proxy (rate limiting)
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers["x-request-id"] as string) || randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === "/health" },
    })
  );
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 500,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many requests, try again later")),
    })
  );
  app.use(originCheck);

  app.get("/health", (_req, res) => {
    const db = isDbReady();
    res.status(db ? 200 : 503).json({ data: { ok: db, db: db ? "up" : "down" } });
  });

  app.use("/auth", authRoutes);
  app.use("/users", userRoutes);
  app.use("/orders", orderRoutes);
  app.use("/couriers", courierRoutes);
  app.use("/merchants", merchantRoutes);
  app.use("/reports", reportRoutes);
  app.use("/access-requests", accessRequestRoutes);
  app.use("/platform", platformRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
