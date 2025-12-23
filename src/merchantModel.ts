import mongoose from "mongoose";

const merchantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true
    },
    apiKey: {
      type: String,
      required: true,
      unique: true
    }
  },
  { timestamps: true }
);

export const merchantModel = mongoose.model("Merchant", merchantSchema);
