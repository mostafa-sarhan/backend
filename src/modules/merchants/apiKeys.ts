import { createHash, randomBytes } from "crypto";

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

// High-entropy random key, so a fast hash (SHA-256) is enough to store it safely.
export function generateApiKey() {
  const key = `mk_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 10) };
}
