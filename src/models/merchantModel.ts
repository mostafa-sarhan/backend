import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";

const merchantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    apiKey: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

export type MerchantDocument = HydratedDocument<InferSchemaType<typeof merchantSchema>>;

export const merchantModel = mongoose.model("Merchant", merchantSchema);
