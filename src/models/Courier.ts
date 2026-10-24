import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";

const courierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
  },
  { timestamps: true }
);

// Phase C: becomes { tenantId: 1, name: 1 }.
courierSchema.index({ name: 1 }, { unique: true });

export type CourierDoc = HydratedDocument<InferSchemaType<typeof courierSchema>>;
// Existing data lives in the "deliveries" collection.
export const Courier = mongoose.model("Courier", courierSchema, "deliveries");
