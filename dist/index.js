"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
///<reference path="./types/express.d.ts" />
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
// Routes
const users_1 = __importDefault(require("./routes/users"));
const orders_1 = __importDefault(require("./routes/orders"));
const auth_1 = __importDefault(require("./routes/auth"));
const deliveries_1 = __importDefault(require("./routes/deliveries"));
const merchants_1 = __importDefault(require("./routes/merchants"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), ".env") });
console.log("ENV CHECK:", {
    JWT: process.env.JWT_SECRET,
    MONGO: process.env.MONGO_URI ? "OK" : "NO"
});
const app = (0, express_1.default)();
const port = process.env.PORT || 5000;
// ---------------- Middleware ----------------
app.use((0, cors_1.default)({
    origin: [
        "http://localhost:5173",
        "https://sys-shipping-bp0bpp5tc-mostafa-sarhans-projects.vercel.app",
        "https://system-shipping.onrender.com",
        "https://sys-shipping-fq92beg72-mostafa-sarhans-projects.vercel.app",
        "https://sys-shipping-dtbownf6v-mostafa-sarhans-projects.vercel.app",
        "https://sys-shipping-k99g6uk18-mostafa-sarhans-projects.vercel.app",
    ]
}));
app.use(express_1.default.json());
// ---------------- Database ----------------
mongoose_1.default.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ CONNECTED"))
    .catch(err => console.log("❌ CONNECT ERROR", err));
console.log("MONGO_URI =", process.env.MONGO_URI);
// ---------------- Routes ----------------
app.use("/auth", auth_1.default); // Login / Auth
app.use("/users", users_1.default); // Users CRUD
app.use("/orders", orders_1.default); // Orders CRUD
app.use("/deliveries", deliveries_1.default); // Deliveries CRUD
app.use("/merchants", merchants_1.default); // Merchants & Merchant Orders
// ---------------- Global Error Handler ----------------
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
});
// ---------------- Start Server ----------------
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
