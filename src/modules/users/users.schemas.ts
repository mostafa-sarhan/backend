import { z } from "zod";
import { ROLES } from "./user.model";
import { AUDIT_ENTITIES } from "../audit/auditEvent.model";
import { str, pagination, objectId } from "../../lib/validate";

export const role = z.enum(ROLES);
// Courier and merchant logins are created from the Couriers / Merchants pages (linked to their record).
export const staffRole = z.enum(["owner", "admin", "employee"]);
export const createUserBody = z.object({ email: str.email, password: z.string().max(200), role: staffRole }).strict();
export const setPasswordBody = z.object({ newPassword: z.string().max(200) }).strict();
export const setRoleBody = z.object({ role: staffRole }).strict();
export const auditLogQuery = pagination.extend({ entity: z.enum(AUDIT_ENTITIES).optional(), entityId: objectId.optional() });
