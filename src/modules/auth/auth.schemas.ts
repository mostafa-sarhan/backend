import { z } from "zod";
import { str } from "../../lib/validate";

export const loginBody = z.object({ email: str.email, password: z.string().min(1).max(200) }).strict();
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) }).strict();
