import cron from "node-cron";
import { orderModel } from "./models/order";

// كل يوم الساعة 12 بليل
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
      {
        $set: { isArchived: true }
      }
    );

    console.log("Archived orders:", result.modifiedCount);
  } catch (error) {
    console.error("Archive job error:", error);
  }
});
