import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import { orderModel } from "./models/order";
import { deliveryModel } from "./delivery";
import "./archiveOrder";
import { merchantModel } from "./merchantModel";
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";




// Load environment variables from .env
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// MongoDB URI from environment
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  throw new Error("Missing MONGO_URI in environment variables");
}

// Connect to MongoDB Atlas
mongoose.connect(mongoUri)
  .then(() => console.log("✅ Connected to MongoDB Atlas!"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Middleware
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://sys-shipping-bp0bpp5tc-mostafa-sarhans-projects.vercel.app/",
    "https://system-shipping.onrender.com",
    "https://sys-shipping-fq92beg72-mostafa-sarhans-projects.vercel.app",
  ]
}));
app.use(express.json());

// ================================
// Routes
// ================================

// Get all orders
app.get("/orders", async (req,res) => {
  try {
    const order = await orderModel.find();
    res.send(order);
  } catch (error) {
    console.error("GET /orders error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});



// Get order by ID
app.get("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const order = await orderModel.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
});

// Create new order
app.post("/orders", async (req, res) => {
  try {
    const data = req.body;
    const newOrder = await orderModel.create(data);
    res.status(201).json(newOrder);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Create failed", error });
  }
});

// Update full order
app.put("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const order = await orderModel.findByIdAndUpdate(id, data, { new: true });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Update failed", error });
  }
});

// Patch order (partial update)
app.patch("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const order = await orderModel.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Patch failed", error });
  }
});

// Delete order
app.delete("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const order = await orderModel.findByIdAndDelete(id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.status(200).json({ message: "Order deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Delete failed", error });
  }
});

// Get order by barcode
app.get("/orders/barcode/:barcode", async (req, res) => {
  try {
    const { barcode } = req.params;
    const order = await orderModel.findOne({ barcode });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
});

// Get orders by delivery
app.get("/orders/delivery/:delivery", async (req, res) => {
  try {
    const { delivery } = req.params;
    const orders = await orderModel.find({ delivery }).sort({ createdAt: -1 });
    if (!orders.length) return res.status(404).json({ message: "No orders for this delivery" });
    res.status(200).json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
});


//---------------------------
//start Delivery
//---------------------------
// Add new delivery
app.post("/deliveries", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Delivery name required" });
    const exists = await deliveryModel.findOne({ name });
    if (exists) return res.status(400).json({ message: "Delivery already exists" });
    const delivery = await deliveryModel.create({ name });
    res.status(201).json(delivery);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Create delivery failed", error });
  }
});

// Get all deliveries
app.get("/deliveries", async (req, res) => {
  try {
    const deliveries = await deliveryModel.find().sort({ createdAt: -1 });
    res.status(200).json(deliveries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
});


//------------------------
//End Delivery
//------------------------


//-------------------------
//merchant model
//-------------------------



export const merchantAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiKey = req.headers["api-key"] as string | undefined;

    if (!apiKey) {
      return res.status(401).json({ message: "API Key required" });
    }

    const merchant = await merchantModel.findOne({ apiKey });

    if (!merchant) {
      return res.status(403).json({ message: "Invalid API Key" });
    }

    req.merchant = merchant; // ✅ دلوقتي TypeScript عارفها

    next();
  } catch (error) {
    console.error("Merchant Auth Error:", error);
    res.status(500).json({ message: "Auth failed" });
  }
};


// Merchant create order
app.post("/merchant/order",merchantAuth,
  async (req: Request, res: Response) => {
    try {
      const { fullName, phone, address, cost, barcode } = req.body;

      // 1️⃣ Validation
      if (!fullName || !phone || !address || !cost || !barcode) {
        return res.status(400).json({
          message: "Incomplete order data"
        });
      }

      // 2️⃣ التاجر الحقيقي من API Key
      const merchant = req.merchant!;
      const company = merchant.name; // 🔒 ثابت

      // 3️⃣ Check على الباركود (قبل الإنشاء)
      const barcodeExists = await orderModel.findOne({ barcode });

      if (barcodeExists) {
        return res.status(409).json({
          message: "Barcode already exists",
          barcode
        });
      }

      // 4️⃣ إنشاء الأوردر
      const order = await orderModel.create({
        fullName,
        phone,
        address,
        cost,
        barcode,
        company,
        merchant: merchant._id
      });

      res.status(201).json({
        message: "Order created successfully",
        order
      });

    } catch (error: any) {
      console.error("Create merchant order failed:", error);

      // 5️⃣ حماية إضافية (لو MongoDB unique index)
      if (error.code === 11000) {
        return res.status(409).json({
          message: "Barcode already exists",
          field: "barcode"
        });
      }
      res.status(500).json({
        message: "Create order failed"
      });
    }
  }
);


// إنشاء تاجر جديد مع توليد API Key
//Create a new merchant
app.post("/merchant", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });

    // توليد مفتاح API عشوائي
    const apiKey = crypto.randomBytes(16).toString("hex");

    const merchant = await merchantModel.create({ name, apiKey });
    res.status(201).json({
      message: "Merchant created successfully",
      merchant: {
        id: merchant._id,
        name: merchant.name,
        apiKey: merchant.apiKey
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Create merchant failed" });
  }
});

// ==========================
// Get all merchants
// ==========================
app.get("/merchants", async (req: Request, res: Response) => {
  try {
    const merchants = await merchantModel.find().sort({ createdAt: -1 });

    res.status(200).json({
      count: merchants.length,
      merchants: merchants.map(m => ({
        id: m._id,
        name: m.name,
        apiKey: m.apiKey,
        createdAt: m.createdAt
      }))
    });

  } catch (error) {
    console.error("GET /merchants error:", error);
    res.status(500).json({
      message: "Failed to fetch merchants"
    });
  }
});


//----------------------------
//End of Merchant
//----------------------------


// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
