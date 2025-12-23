import mongoose, { Document } from "mongoose";
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
}
export declare const orderModel: mongoose.Model<Order, {}, {}, {}, mongoose.Document<unknown, {}, Order, {}, mongoose.DefaultSchemaOptions> & Order & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any, Order>;
export {};
//# sourceMappingURL=order.d.ts.map