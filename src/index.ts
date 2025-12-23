import express from "express";
import mongoose from 'mongoose';
import { orderModel } from "./models/order";
import cors from "cors";
import { deliveryModel } from "./delivery";
import "./archiveOrder";



const app = express();
const port = 5000;

app.use(cors({
    origin:["http://localhost:5173","https://sys-shipping-m4j1hlo4n-mostafa-sarhans-projects.vercel.app"]
}));
app.use(express.json());

mongoose.connect('mongodb://127.0.0.1:27017/orders')
    .then(() => console.log('Connected!'));

// app.get("/",(req,res) => {
//     const order = new orderModel ({fullName:"Hoosam_sarhan",phone:"011223",address:"tala",cost:"250",description:"gil",company:"otex"});
//     order.save();
//     res.send("Hello world");
// })

// Get all orders
app.get("/orders",async (req,res) => {
    const order = await orderModel.find()
    res.send(order)
});

// Get unique order
app.get("/orders/:id",async (req,res) => {
    const order = await orderModel.find()
    res.send(order)
})

// create a new order
// send data in body

app.post("/orders",async(req,res)=>{
    const data = req.body;
    const newOrder = await orderModel.create(data);
    res.status(201).send(newOrder);
});


// update a order
app.put("/orders/:id", async (req, res) => {
    const id = req.params.id;
    const data = req.body;
    const order = await orderModel.findByIdAndUpdate(id, data, { new: true });

    if (!order) {
        return res.status(404).send("Order not found");
    }

    return res.status(200).send(order);
});


//patch order

app.patch("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const order = await orderModel.findByIdAndUpdate(
      id,
      { $set: data },   // ✅ PATCH = تعديل جزئي
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json(order);
  } catch (error) {
    return res.status(500).json({ message: "Update failed", error });
  }
});

// delete a order

app.delete("/orders/:id",async (req,res)=>{
    const id = req.params.id;
    const order = await orderModel.findByIdAndDelete(id);

    if (!order) {
        return res.status(404).send("Order not found");
    }

    return res.send("Okey");
})

// Get order by barcode
app.get("/orders/barcode/:barcode", async (req, res) => {
  try {
    const { barcode } = req.params;
    const order = await orderModel.findOne({ barcode });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json(order);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
});

// Get order by barcode
app.get("/orders/barcode/:barcode", async (req, res) => {
  try {
    const { barcode } = req.params;
    const order = await orderModel.findOne({ barcode });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json(order);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
});


// ================================
// Get orders by delivery name
// ================================
app.get("/orders/delivery/:delivery", async (req, res) => {
  try {
    const { delivery } = req.params;

    const orders = await orderModel
      .find({ delivery })
      .sort({ createdAt: -1 });

    if (!orders.length) {
      return res.status(404).json({ message: "No orders for this delivery" });
    }

    return res.status(200).json(orders);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
});


// add new delivery
app.post("/deliveries", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "اسم المندوب مطلوب" });
    }

    const exists = await deliveryModel.findOne({ name });
    if (exists) {
      return res.status(400).json({ message: "المندوب موجود بالفعل" });
    }

    const delivery = await deliveryModel.create({ name });
    return res.status(201).json(delivery);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
});

// get all deliveries
app.get("/deliveries", async (req, res) => {
  try {
    const deliveries = await deliveryModel.find().sort({ createdAt: -1 });
    return res.status(200).json(deliveries);
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
});





app.listen(port, ()=>{
    console.log("Running on port  " + port);
})




