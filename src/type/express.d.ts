import { MerchantDocument } from "./merchantModel";

declare global {
  namespace Express {
    interface Request {
      merchant?: MerchantDocument;
    }
  }
}

export {};