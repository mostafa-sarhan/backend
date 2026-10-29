import mongoose, { HydratedDocument, InferSchemaType } from "mongoose";
import { randomInt } from "crypto";
import { ORDER_STATUSES } from "./orderStatus";
import { tenantScoped, tenantIdField } from "../../lib/tenantPlugin";

export const generateBarcode = () => randomInt(10_000_000, 100_000_000).toString();

const orderSchema = new mongoose.Schema(
  {
    tenantId: tenantIdField,
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
    // Fees in force when the order was delivered (null until then). Reports add these up,
    // so changing the tenant's or merchant's fees never rewrites past statements.
    fees: {
      type: new mongoose.Schema({ courier: { type: Number, min: 0, required: true }, company: { type: Number, min: 0, required: true } }, { _id: false }),
      default: null,
    },
    barcode: { type: String, required: true, default: generateBarcode },
    // The merchant's own order id (merchant API); unique per merchant.
    merchantRef: { type: String, trim: true, maxlength: 60 },
  },
  { timestamps: true }
);

orderSchema.plugin(tenantScoped);
// Barcodes are unique per tenant: no cross-tenant collisions or enumeration through 409s.
orderSchema.index({ tenantId: 1, barcode: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, isArchived: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, courier: 1, status: 1 });
orderSchema.index({ tenantId: 1, merchant: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, phone: 1 });
orderSchema.index({ tenantId: 1, isArchived: 1, status: 1, deliveredAt: 1 }); // archive job
orderSchema.index(
  { tenantId: 1, merchant: 1, merchantRef: 1 },
  { unique: true, partialFilterExpression: { merchantRef: { $type: "string" } } }
);

export type OrderDoc = HydratedDocument<InferSchemaType<typeof orderSchema>>;
export const Order = mongoose.model("Order", orderSchema);

export const isDuplicateBarcode = (err: unknown) => {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  return e?.code === 11000 && !!e.keyPattern?.barcode;
};

// A barcode not yet used in the tenant. Checked before inserting because a duplicate-key error
// would abort the surrounding transaction; the unique index still guards the tiny race window.
export async function freeBarcode(tenantId: mongoose.Types.ObjectId, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const barcode = generateBarcode();
    if (!(await Order.exists({ tenantId, barcode }))) return barcode;
  }
  throw new Error("Could not generate a free barcode");
}

export async function createWithUniqueBarcode(data: Record<string, unknown> & { tenantId: mongoose.Types.ObjectId }) {
  const order = new Order({ ...data, barcode: await freeBarcode(data.tenantId) });
  await order.save();
  return order;
}
