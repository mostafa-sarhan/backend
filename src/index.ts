import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { startArchiveJob } from "./jobs/archiveOrders";

import userRoutes from "./routes/users";
import orderRoutes from "./routes/orders";
import authRoutes from "./routes/auth";
import deliveryRoutes from "./routes/deliveries";
import merchantRoutes from "./routes/merchants";

const app = express();

// ---------------- Middleware ----------------
app.set("trust proxy", 1); // correct client IPs behind a reverse proxy (rate limiting)
app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: "draft-8", legacyHeaders: false }));

// ---------------- Routes ----------------
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/orders", orderRoutes);
app.use("/deliveries", deliveryRoutes);
app.use("/merchants", merchantRoutes);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------------- Global Error Handler ----------------
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Internal Server Error" });
});

// ---------------- Start ----------------
mongoose
  .connect(config.mongoUri)
  .then(() => {
    console.log("✅ MongoDB connected");
    startArchiveJob();
    app.listen(config.port, () => console.log(`🚀 Server running on port ${config.port}`));
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });
