import { MerchantDocument } from "../models/merchantModel";

declare global {
  namespace Express {
    interface Request {
      merchant?: MerchantDocument;
      user?: {
        _id: string;
        email: string;
        role: "admin" | "employee";
      };
    }
  }
}

export {};
