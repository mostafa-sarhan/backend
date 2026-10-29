import type { MerchantDocument } from "../models/Merchant";
import type { TenantDoc } from "../models/Tenant";
import type { Role } from "../models/User";

declare global {
  namespace Express {
    interface Request {
      // Set by requireAuth (tenant users) or merchantAuth (merchant API).
      tenant?: TenantDoc;
      user?: {
        id: string;
        email: string;
        role: Role;
      };
      merchant?: MerchantDocument;
      // Set by requirePlatformAdmin. Never set together with `tenant`.
      platformAdmin?: {
        id: string;
        email: string;
      };
    }
  }
}

export {};
