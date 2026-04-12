"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const delivery_1 = require("./../delivery");
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const adminOnly_1 = require("../middleware/adminOnly");
const router = (0, express_1.Router)();
// ---------------- DELIVERIES ----------------
// Create delivery
router.post("/", auth_1.auth, adminOnly_1.adminOnly, async (req, res) => {
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
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
// Get all deliveries
router.get("/", auth_1.auth, async (_, res) => {
    try {
        const deliveries = await delivery_1.deliveryModel.find().sort({ createdAt: -1 });
        res.json(deliveries);
    }
    catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
exports.default = router;
