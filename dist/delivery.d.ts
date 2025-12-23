import mongoose, { Document } from "mongoose";
interface Delivery extends Document {
    name: string;
    createdAt: Date;
}
export declare const deliveryModel: mongoose.Model<Delivery, {}, {}, {}, mongoose.Document<unknown, {}, Delivery, {}, mongoose.DefaultSchemaOptions> & Delivery & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any, Delivery>;
export {};
//# sourceMappingURL=delivery.d.ts.map