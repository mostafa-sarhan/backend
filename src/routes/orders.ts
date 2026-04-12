import { Router, Request, Response } from "express";
import { orderModel } from "../models/order";
import { auth } from "../middleware/auth";

const router = Router();

// ---------------- ORDERS ----------------

// Get all orders
router.get("/", auth, async (_, res: Response) => {
  try {
    const orders = await orderModel.find();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


router.get("/delivery/:deliveryId", auth, async (req: Request, res: Response) => {
  try {
    const { deliveryId } = req.params;

    // تأكد أن الحقل اللي في الأوردر اسمه "delivery"
    const orders = await orderModel.find({ delivery: deliveryId });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get order by ID
router.get("/:id", auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const order = await orderModel.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Create order
router.post("/", auth, async (req: Request, res: Response) => {
  try {
    const order = await orderModel.create(req.body);
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Update full order
router.put("/:id", auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const order = await orderModel.findByIdAndUpdate(id, req.body, { new: true });
    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Patch order
router.patch("/:id", auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const order = await orderModel.findByIdAndUpdate(id, { $set: req.body }, { new: true });
    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Delete order
router.delete("/:id", auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const order = await orderModel.findByIdAndDelete(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json({ message: "Order deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
    //res.status(500).json({message: "server error"});
  }
});


//get order by barcode to get item
router.get("/barcode/:barcode", auth, async (req: Request, res: Response) => {
  try {
    const { barcode } = req.params;

    const order = await orderModel.findOne({ barcode });
    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
