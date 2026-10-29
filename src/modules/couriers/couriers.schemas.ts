import { z } from "zod";
import { str } from "../../lib/validate";

export const courierBody = z.object({ name: str.name }).strict();
