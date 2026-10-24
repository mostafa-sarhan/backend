import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";
import { randomInt } from "crypto";
import { ORDER_STATUSES } from "../domain/orderStatus";

export const generateBarcode = () => randomInt(10_000_000, 100_000_000).toString();

const orderSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    cost: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true, maxlength: 1000 },
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant" },
    courier: { type: mongoose.Schema.Types.ObjectId, ref: "Courier", default: null },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", required: true },
    isArchived: { type: Boolean, default: false, required: true },
    // When the order reached a final status (delivered / returned / refused).
    deliveredAt: { type: Date, default: null },
    barcode: { type: String, required: true, default: generateBarcode },
    // The merchant's own order id (merchant API); unique per merchant.
    merchantRef: { type: String, trim: true, maxlength: 60 },
  },
  { timestamps: true }
);

// Phase C: prefix every index with tenantId (barcode stays globally unique for scanning).
orderSchema.index({ barcode: 1 }, { unique: true });
orderSchema.index({ isArchived: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ courier: 1, status: 1 });
orderSchema.index({ merchant: 1, createdAt: -1 });
orderSchema.index({ phone: 1 });
orderSchema.index({ isArchived: 1, status: 1, deliveredAt: 1 }); // archive job
orderSchema.index({ merchant: 1, merchantRef: 1 }, { unique: true, partialFilterExpression: { merchantRef: { $type: "string" } } });

export type OrderDoc = HydratedDocument<InferSchemaType<typeof orderSchema>>;
export const Order = mongoose.model("Order", orderSchema);

export const isDuplicateBarcode = (err: unknown) => {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  return e?.code === 11000 && !!e.keyPattern?.barcode;
};

// Creates an order with a generated barcode, retrying on the rare collision.
export async function createWithUniqueBarcode(data: Record<string, unknown>, attempts = 5) {
  for (let i = 0; ; i++) {
    try {
      return await Order.create({ ...data, barcode: generateBarcode() });
    } catch (err) {
      if (!isDuplicateBarcode(err) || i >= attempts - 1) throw err;
    }
  }
}
