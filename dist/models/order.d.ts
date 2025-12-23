import mongoose, { Document } from "mongoose";
interface order extends Document {
    fullName: string;
    phone: string;
    address: string;
    cost: string;
    description: string;
    company: string;
}
export declare const orderModel: mongoose.Model<order, {}, {}, {}, mongoose.Document<unknown, {}, order, {}, mongoose.DefaultSchemaOptions> & order & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any, order>;
export {};
//# sourceMappingURL=order.d.ts.map