import mongoose, { Schema, Document } from "mongoose";

export const ORDER_STATUSES = ["قيد التنفيذ", "مع المندوب", "تم التسليم", "مرتجع", "استبدال", "مرفوض"];
// Statuses that close an order; they start the archive countdown.
export const FINAL_STATUSES = ["تم التسليم", "مرتجع", "مرفوض"];

interface Order extends Document {
  fullName: string;
  phone: string;
  address: string;
  cost: number;
  description?: string;
  company?: string;
  barcode: string;
  delivery: string;
  status: string;
  isArchived: boolean;
  deliveredAt?: Date;
  merchant?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const generateBarcode = () => Math.floor(10000000 + Math.random() * 90000000).toString();

const orderSchema = new Schema<Order>(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    cost: { type: Number, required: true },
    description: { type: String },
    company: { type: String },
    delivery: { type: String, default: "لم يحدد" },
    status: { type: String, default: "قيد التنفيذ" },
    isArchived: { type: Boolean, default: false },
    deliveredAt: { type: Date },
    merchant: { type: Schema.Types.ObjectId, ref: "Merchant" },
    barcode: { type: String, required: true, unique: true, default: generateBarcode },
  },
  { timestamps: true }
);

export const orderModel = mongoose.model<Order>("orders", orderSchema);

const isDuplicateBarcode = (err: any) => err?.code === 11000 && err?.keyPattern?.barcode;

// Creates an order; if the barcode was auto-generated and collides, retries with a new one.
export async function createOrderWithBarcode(data: Record<string, unknown>, attempts = 5) {
  const autoBarcode = !data.barcode;
  for (let i = 0; ; i++) {
    try {
      return await orderModel.create(autoBarcode ? { ...data, barcode: generateBarcode() } : data);
    } catch (err) {
      if (!autoBarcode || !isDuplicateBarcode(err) || i >= attempts - 1) throw err;
    }
  }
}

export { isDuplicateBarcode };
