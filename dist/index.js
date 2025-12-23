"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const order_1 = require("./models/order");
const app = (0, express_1.default)();
const port = 5000;
app.use(express_1.default.json());
mongoose_1.default.connect('mongodb://127.0.0.1:27017/orders')
    .then(() => console.log('Connected!'));
// app.get("/",(req,res) => {
//     const order = new orderModel ({fullName:"Hoosam_sarhan",phone:"011223",address:"tala",cost:"250",description:"gil",company:"otex"});
//     order.save();
//     res.send("Hello world");
// })
// Get all orders
app.get("/orders", async (req, res) => {
    const order = await order_1.orderModel.find();
    res.send(order);
});
// Get unique order
app.get("/orders/:id", async (req, res) => {
    const order = await order_1.orderModel.find();
    res.send(order);
});
// create a new order
// send data in body
app.post("/orders", async (req, res) => {
    const data = req.body;
    const newOrder = await order_1.orderModel.create(data);
    res.status(201).send(newOrder);
});
// update a order
app.put("/orders/:id", async (req, res) => {
    const id = req.params.id;
    const data = req.body;
    const order = await order_1.orderModel.findByIdAndUpdate(id, data, { new: true });
    if (!order) {
        return res.status(404);
    }
    return res.status(200).send(order);
});
app.listen(port, () => {
    console.log("Running on port  " + port);
});
//# sourceMappingURL=index.js.map