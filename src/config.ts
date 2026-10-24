import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: required("MONGO_URI"),
  jwtSecret: required("JWT_SECRET"),
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};
