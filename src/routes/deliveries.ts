import { deliveryModel } from './../delivery';
import { Router, Request, Response } from "express";
import { auth } from "../middleware/auth";
import { adminOnly } from "../middleware/adminOnly";

const router = Router();

// ---------------- DELIVERIES ----------------

// Create delivery
router.post("/", auth, adminOnly, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Delivery name required" });

    const exists = await deliveryModel.findOne({ name });
    if (exists) return res.status(400).json({ message: "Delivery already exists" });

    const delivery = await deliveryModel.create({ name });
    res.status(201).json(delivery);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get all deliveries
router.get("/", auth, async (_: Request, res: Response) => {
  try {
    const deliveries = await deliveryModel.find().sort({ createdAt: -1 });
    res.json(deliveries);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
