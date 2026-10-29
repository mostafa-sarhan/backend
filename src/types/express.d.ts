import type { MerchantDocument } from "../modules/merchants/merchant.model";
import type { TenantDoc } from "../modules/tenants/tenant.model";
import type { Role } from "../modules/users/user.model";

declare global {
  namespace Express {
    interface Request {
      // Set by requireAuth (tenant users) or merchantAuth (merchant API).
      tenant?: TenantDoc;
      user?: {
        id: string;
        email: string;
        role: Role;
        mustChangePassword?: boolean;
        courierId?: string;
        merchantId?: string;
      };
      merchant?: MerchantDocument;
      // Set by requirePlatformAdmin. Never set together with `tenant`.
      platformAdmin?: {
        id: string;
        email: string;
        mustChangePassword?: boolean;
      };
    }
  }
}

export {};
