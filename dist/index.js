"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.merchantAuth = void 0;
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const order_1 = require("./models/order");
const delivery_1 = require("./delivery");
require("./archiveOrder");
const merchantModel_1 = require("./merchantModel");
const crypto_1 = __importDefault(require("crypto"));
// Load environment variables from .env
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 5000;
// MongoDB URI from environment
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    throw new Error("Missing MONGO_URI in environment variables");
}
// Connect to MongoDB Atlas
mongoose_1.default.connect(mongoUri)
    .then(() => console.log("✅ Connected to MongoDB Atlas!"))
    .catch(err => console.error("❌ MongoDB connection error:", err));
// Middleware
app.use((0, cors_1.default)({
    origin: [
        "http://localhost:5173",
        "https://sys-shipping-m4j1hlo4n-mostafa-sarhans-projects.vercel.app",
        "https://system-shipping.onrender.com",
        "https://sys-shipping-fq92beg72-mostafa-sarhans-projects.vercel.app",
    ]
}));
app.use(express_1.default.json());
// ================================
// Routes
// ================================
// Get all orders
app.get("/orders", async (req, res) => {
    try {
        const order = await order_1.orderModel.find();
        res.send(order);
    }
    catch (error) {
        console.error("GET /orders error:", error);
        res.status(500).json({ message: "Server error", error });
    }
});
// Get order by ID
app.get("/orders/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const order = await order_1.orderModel.findById(id);
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.status(200).json(order);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error", error });
    }
});
// Create new order
app.post("/orders", async (req, res) => {
    try {
        const data = req.body;
        const newOrder = await order_1.orderModel.create(data);
        res.status(201).json(newOrder);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Create failed", error });
    }
});
// Update full order
app.put("/orders/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const order = await order_1.orderModel.findByIdAndUpdate(id, data, { new: true });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.status(200).json(order);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Update failed", error });
    }
});
// Patch order (partial update)
app.patch("/orders/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const order = await order_1.orderModel.findByIdAndUpdate(id, { $set: data }, { new: true });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.status(200).json(order);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Patch failed", error });
    }
});
// Delete order
app.delete("/orders/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const order = await order_1.orderModel.findByIdAndDelete(id);
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.status(200).json({ message: "Order deleted" });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Delete failed", error });
    }
});
// Get order by barcode
app.get("/orders/barcode/:barcode", async (req, res) => {
    try {
        const { barcode } = req.params;
        const order = await order_1.orderModel.findOne({ barcode });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.status(200).json(order);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error", error });
    }
});
// Get orders by delivery
app.get("/orders/delivery/:delivery", async (req, res) => {
    try {
        const { delivery } = req.params;
        const orders = await order_1.orderModel.find({ delivery }).sort({ createdAt: -1 });
        if (!orders.length)
            return res.status(404).json({ message: "No orders for this delivery" });
        res.status(200).json(orders);
    }
    catch (error) {
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
        if (!name)
            return res.status(400).json({ message: "Delivery name required" });
        const exists = await delivery_1.deliveryModel.findOne({ name });
        if (exists)
            return res.status(400).json({ message: "Delivery already exists" });
        const delivery = await delivery_1.deliveryModel.create({ name });
        res.status(201).json(delivery);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Create delivery failed", error });
    }
});
// Get all deliveries
app.get("/deliveries", async (req, res) => {
    try {
        const deliveries = await delivery_1.deliveryModel.find().sort({ createdAt: -1 });
        res.status(200).json(deliveries);
    }
    catch (error) {
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
const merchantAuth = async (req, res, next) => {
    try {
        const apiKey = req.headers["api-key"];
        if (!apiKey) {
            return res.status(401).json({ message: "API Key required" });
        }
        const merchant = await merchantModel_1.merchantModel.findOne({ apiKey });
        if (!merchant) {
            return res.status(403).json({ message: "Invalid API Key" });
        }
        req.merchant = merchant; // ✅ دلوقتي TypeScript عارفها
        next();
    }
    catch (error) {
        console.error("Merchant Auth Error:", error);
        res.status(500).json({ message: "Auth failed" });
    }
};
exports.merchantAuth = merchantAuth;
// Merchant create order
app.post("/merchant/order", exports.merchantAuth, async (req, res) => {
    try {
        const { fullName, phone, address, cost, barcode } = req.body;
        // 1️⃣ Validation
        if (!fullName || !phone || !address || !cost || !barcode) {
            return res.status(400).json({
                message: "Incomplete order data"
            });
        }
        // 2️⃣ التاجر الحقيقي من API Key
        const merchant = req.merchant;
        const company = merchant.name; // 🔒 ثابت
        // 3️⃣ Check على الباركود (قبل الإنشاء)
        const barcodeExists = await order_1.orderModel.findOne({ barcode });
        if (barcodeExists) {
            return res.status(409).json({
                message: "Barcode already exists",
                barcode
            });
        }
        // 4️⃣ إنشاء الأوردر
        const order = await order_1.orderModel.create({
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
    }
    catch (error) {
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
});
// إنشاء تاجر جديد مع توليد API Key
//Create a new merchant
app.post("/merchant", async (req, res) => {
    try {
        const { name } = req.body;
        if (!name)
            return res.status(400).json({ message: "Name is required" });
        // توليد مفتاح API عشوائي
        const apiKey = crypto_1.default.randomBytes(16).toString("hex");
        const merchant = await merchantModel_1.merchantModel.create({ name, apiKey });
        res.status(201).json({
            message: "Merchant created successfully",
            merchant: {
                id: merchant._id,
                name: merchant.name,
                apiKey: merchant.apiKey
            }
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Create merchant failed" });
    }
});
// ==========================
// Get all merchants
// ==========================
app.get("/merchants", async (req, res) => {
    try {
        const merchants = await merchantModel_1.merchantModel.find().sort({ createdAt: -1 });
        res.status(200).json({
            count: merchants.length,
            merchants: merchants.map(m => ({
                id: m._id,
                name: m.name,
                apiKey: m.apiKey,
                createdAt: m.createdAt
            }))
        });
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map