"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const order_1 = require("./models/order");
// كل يوم الساعة 12 بليل
node_cron_1.default.schedule("0 0 * * *", async () => {
    try {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const result = await order_1.orderModel.updateMany({
            createdAt: { $lte: threeDaysAgo },
            isArchived: false,
            status: { $in: ["تم التسليم", "مرتجع", "مرفوض"] }
        }, {
            $set: { isArchived: true }
        });
        console.log("Archived orders:", result.modifiedCount);
    }
    catch (error) {
        console.error("Archive job error:", error);
    }
});
//# sourceMappingURL=archiveOrder.js.map