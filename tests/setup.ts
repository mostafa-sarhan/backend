// Env must be set before src/config is imported.
process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://placeholder"; // replaced per test file by the in-memory server
process.env.JWT_SECRET = "test-secret";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.COOKIE_SECURE = "false"; // supertest talks plain http
process.env.DEFAULT_COURIER_FEE = "20";
process.env.DEFAULT_COMPANY_FEE = "10";
