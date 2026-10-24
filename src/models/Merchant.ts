import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";

const merchantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    apiKey: { type: String },
  },
  { timestamps: true }
);

// Phase C: becomes { tenantId: 1, name: 1 }.
merchantSchema.index({ name: 1 }, { unique: true });
merchantSchema.index({ apiKey: 1 }, { unique: true, sparse: true });

export type MerchantDocument = HydratedDocument<InferSchemaType<typeof merchantSchema>>;
export const Merchant = mongoose.model("Merchant", merchantSchema);
