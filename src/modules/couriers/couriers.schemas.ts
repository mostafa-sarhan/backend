import { z } from "zod";
import { str } from "../../lib/validate";

export const courierBody = z.object({ name: str.name }).strict();
// Login for the courier mobile view (one per courier). The password is a one-time password.
export const accountBody = z.object({ email: str.email, password: z.string().max(200) }).strict();
