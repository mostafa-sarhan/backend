import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import cron from "node-cron";
import { orderModel } from "./models/order";

mongoose.connect(process.env.MONGO_URI!)
  .then(() => console.log("Archive DB Connected"))
  .catch(err => console.error(err));

console.log("Archive cron started");

cron.schedule("* * * * *", async () => {
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const result = await orderModel.updateMany(
      {
        createdAt: { $lte: threeDaysAgo },
        isArchived: false,
        status: { $in: ["تم التسليم", "مرتجع", "مرفوض"] }
      },
      { $set: { isArchived: true } }
    );

    console.log("Archived:", result.modifiedCount);
  } catch (err) {
    console.error("Archive error:", err);
  }
});
