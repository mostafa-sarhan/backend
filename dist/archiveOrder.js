"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const mongoose_1 = __importDefault(require("mongoose"));
const node_cron_1 = __importDefault(require("node-cron"));
const order_1 = require("./models/order");
mongoose_1.default.connect(process.env.MONGO_URI)
    .then(() => console.log("Archive DB Connected"))
    .catch(err => console.error(err));
console.log("Archive cron started");
node_cron_1.default.schedule("* * * * *", async () => {
    try {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const result = await order_1.orderModel.updateMany({
            createdAt: { $lte: threeDaysAgo },
            isArchived: false,
            status: { $in: ["تم التسليم", "مرتجع", "مرفوض"] }
        }, { $set: { isArchived: true } });
        console.log("Archived:", result.modifiedCount);
    }
    catch (err) {
        console.error("Archive error:", err);
    }
});
