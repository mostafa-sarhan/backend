"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = require("../models/User");
const auth = async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
        return res.status(401).json({ message: "No token" });
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        const user = await User_1.User.findById(decoded.id).select("-password");
        if (!user)
            return res.status(401).json({ message: "Invalid token" });
        // Type assertion للتأكد لـ TypeScript
        req.user = {
            _id: user._id.toString(),
            email: user.email,
            role: user.role, // 🟢 هنا
        };
        next();
    }
    catch (err) {
        console.error(err);
        res.status(401).json({ message: "Unauthorized" });
    }
};
exports.auth = auth;
