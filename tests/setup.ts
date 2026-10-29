// Env must be set before src/config is imported.
process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://placeholder"; // replaced per test file by the in-memory server
process.env.JWT_SECRET = "test-secret";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.COOKIE_SECURE = "false"; // supertest talks plain http
process.env.DEFAULT_COURIER_FEE = "20";
process.env.DEFAULT_COMPANY_FEE = "10";
// Every test request comes from 127.0.0.1: keep IP-wide limits out of the way.
// Each limiter has its own test (tests/rateLimit.test.ts) with small, explicit limits.
process.env.RATE_LIMIT_GLOBAL_PER_15MIN = "100000";
process.env.RATE_LIMIT_LOGIN_IP_PER_15MIN = "100000";
process.env.RATE_LIMIT_PLATFORM_LOGIN_IP_PER_15MIN = "100000";
process.env.RATE_LIMIT_REFRESH_IP_PER_15MIN = "100000";
process.env.RATE_LIMIT_ACCESS_REQUEST_IP_PER_HOUR = "100000";
process.env.RATE_LIMIT_TRACKING_IP_PER_MIN = "100000";
