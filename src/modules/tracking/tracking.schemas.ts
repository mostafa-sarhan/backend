import { z } from "zod";

// Any string up to 40 chars; the format check happens in the service so a bad id and an unknown id
// get the same 404 (nothing to learn by probing).
export const trackingParams = z.object({ trackingId: z.string().max(40) });
