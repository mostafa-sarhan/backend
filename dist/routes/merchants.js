"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.merchantAuth = void 0;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const merchantModel_1 = require("../models/merchantModel");
const order_1 = require("../models/order");
const auth_1 = require("../middleware/auth");
const adminOnly_1 = require("../middleware/adminOnly");
const router = (0, express_1.Router)();
// ---------------- Merchant Auth Middleware ----------------
const merchantAuth = async (req, res, next) => {
    try {
        const apiKey = req.headers["api-key"];
        if (!apiKey)
            return res.status(401).json({ message: "API Key required" });
        const merchant = await merchantModel_1.merchantModel.findOne({ apiKey });
        if (!merchant)
            return res.status(403).json({ message: "Invalid API Key" });
        req.merchant = merchant;
        next();
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
};
exports.merchantAuth = merchantAuth;
// ---------------- MERCHANTS ----------------
// Create merchant
router.post("/", auth_1.auth, adminOnly_1.adminOnly, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name)
            return res.status(400).json({ message: "Name is required" });
        const apiKey = crypto_1.default.randomBytes(16).toString("hex");
        const merchant = await merchantModel_1.merchantModel.create({ name, apiKey });
        res.status(201).json(merchant);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Get all merchants
router.get("/", auth_1.auth, adminOnly_1.adminOnly, async (_, res) => {
    try {
        const merchants = await merchantModel_1.merchantModel.find().sort({ createdAt: -1 });
        res.json(merchants);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// ---------------- MERCHANT CREATE ORDER ----------------
router.post("/order", exports.merchantAuth, async (req, res) => {
    try {
        const { fullName, phone, address, cost, barcode } = req.body;
        if (!fullName || !phone || !address || !cost || !barcode)
            return res.status(400).json({ message: "Incomplete order data" });
        const merchant = req.merchant;
        const barcodeExists = await order_1.orderModel.findOne({ barcode });
        if (barcodeExists)
            return res.status(409).json({ message: "Barcode already exists" });
        const order = await order_1.orderModel.create({
            fullName,
            phone,
            address,
            cost,
            barcode,
            company: merchant.name,
            merchant: merchant._id,
        });
        res.status(201).json(order);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
exports.default = router;
