"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.merchantModel = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const merchantSchema = new mongoose_1.default.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    apiKey: {
        type: String,
        required: true,
        unique: true
    }
}, { timestamps: true });
exports.merchantModel = mongoose_1.default.model("Merchant", merchantSchema);
