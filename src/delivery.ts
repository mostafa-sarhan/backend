import mongoose, { Schema, Document } from "mongoose";

interface Delivery extends Document {
  name: string;
  createdAt: Date;
}

const deliverySchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
  },
  { timestamps: true }
);

export const deliveryModel = mongoose.model<Delivery>(
  "deliveries",
  deliverySchema
);
