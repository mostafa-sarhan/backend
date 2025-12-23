import mongoose, { Schema, Document } from "mongoose";

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
  createdAt: Date;
  merchant?: mongoose.Types.ObjectId; // <-- ضيف ده

}

const orderSchema: Schema = new Schema(
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
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant" }, // <-- ضيف هنا
    barcode: {
      type: String,
      required: true,
      unique: true,   // ⭐ أهم سطر
      index: true,
      default: () =>
        Math.floor(10000000 + Math.random() * 90000000).toString(),
    },

  },
  {
    timestamps: true, // ⭐ ده هيعمل createdAt و updatedAt تلقائي
  }
);



export const orderModel = mongoose.model<Order>("orders", orderSchema);
