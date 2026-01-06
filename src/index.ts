///<reference path="./types/express.d.ts" />
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

// Routes
import userRoutes from "./routes/users";
import orderRoutes from "./routes/orders";
import authRoutes from "./routes/auth";
import deliveryRoutes from "./routes/deliveries";
import merchantRoutes from "./routes/merchants";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// ---------------- Middleware ----------------
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://sys-shipping-bp0bpp5tc-mostafa-sarhans-projects.vercel.app",
    "https://system-shipping.onrender.com",
    "https://sys-shipping-fq92beg72-mostafa-sarhans-projects.vercel.app",
  ]
}));
app.use(express.json());

// ---------------- Database ----------------
mongoose.connect(process.env.MONGO_URI!)
  .then(() => console.log("✅ Mongo connected"))
  .catch(err => console.error("❌ Mongo error:", err));

// ---------------- Routes ----------------
app.use("/auth", authRoutes);         // Login / Auth
app.use("/users", userRoutes);       // Users CRUD
app.use("/orders", orderRoutes);     // Orders CRUD
app.use("/deliveries", deliveryRoutes); // Deliveries CRUD
app.use("/merchants", merchantRoutes);  // Merchants & Merchant Orders

// ---------------- Global Error Handler ----------------
app.use((err: any, req: any, res: any, next: any) => {
  console.error(err);
  res.status(500).json({ message: "Internal Server Error" });
});

// ---------------- Start Server ----------------
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
