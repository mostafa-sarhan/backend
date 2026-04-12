"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLog = void 0;
// models/AuditLog.ts
const mongoose_1 = __importDefault(require("mongoose"));
const auditLogSchema = new mongoose_1.default.Schema({
    action: String, // CHANGE_ROLE / CHANGE_PASSWORD
    targetUser: String,
    oldValue: String,
    newValue: String,
    changedBy: String,
}, { timestamps: true });
exports.AuditLog = mongoose_1.default.model("AuditLog", auditLogSchema);
//-----------------------------------
//------------------------------------
