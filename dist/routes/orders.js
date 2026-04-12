"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const order_1 = require("../models/order");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ---------------- ORDERS ----------------
// Get all orders
router.get("/", auth_1.auth, async (_, res) => {
    try {
        const orders = await order_1.orderModel.find();
        res.json(orders);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
router.get("/delivery/:deliveryId", auth_1.auth, async (req, res) => {
    try {
        const { deliveryId } = req.params;
        // تأكد أن الحقل اللي في الأوردر اسمه "delivery"
        const orders = await order_1.orderModel.find({ delivery: deliveryId });
        res.json(orders);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Get order by ID
router.get("/:id", auth_1.auth, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await order_1.orderModel.findById(id);
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.json(order);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Create order
router.post("/", auth_1.auth, async (req, res) => {
    try {
        const order = await order_1.orderModel.create(req.body);
        res.status(201).json(order);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Update full order
router.put("/:id", auth_1.auth, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await order_1.orderModel.findByIdAndUpdate(id, req.body, { new: true });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.json(order);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Patch order
router.patch("/:id", auth_1.auth, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await order_1.orderModel.findByIdAndUpdate(id, { $set: req.body }, { new: true });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.json(order);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Delete order
router.delete("/:id", auth_1.auth, async (req, res) => {
    try {
        const { id } = req.params;
        const order = await order_1.orderModel.findByIdAndDelete(id);
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.json({ message: "Order deleted" });
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
        //res.status(500).json({message: "server error"});
    }
});
//get order by barcode to get item
router.get("/barcode/:barcode", auth_1.auth, async (req, res) => {
    try {
        const { barcode } = req.params;
        const order = await order_1.orderModel.findOne({ barcode });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.json(order);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
exports.default = router;
