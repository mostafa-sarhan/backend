import type { MerchantDocument } from "../models/merchantModel";
import type { Role } from "../models/User";

declare global {
  namespace Express {
    interface Request {
      merchant?: MerchantDocument;
      user?: {
        id: string;
        email: string;
        role: Role;
      };
    }
  }
}

export {};
