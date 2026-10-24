import jwt from "jsonwebtoken";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Response, CookieOptions } from "express";
import mongoose from "mongoose";
import { config } from "../config";
import { RefreshToken } from "../models/RefreshToken";
import { User, UserDoc } from "../models/User";
import { AppError } from "./errors";

const ALGORITHM = "HS256";
const ISSUER = "shipping-api";
export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

interface AccessPayload {
  sub: string;
  role: string;
  tv: number;
}

export const signAccessToken = (user: UserDoc) =>
  jwt.sign({ role: user.role, tv: user.tokenVersion } satisfies Omit<AccessPayload, "sub">, config.jwtSecret, {
    algorithm: ALGORITHM,
    expiresIn: config.accessTokenTtlSec,
    issuer: ISSUER,
    subject: user._id.toString(),
  });

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, config.jwtSecret, { algorithms: [ALGORITHM], issuer: ISSUER }) as AccessPayload;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Refresh token format: "<documentId>.<random secret>". Only the secret's hash is stored.
export async function issueRefreshToken(user: UserDoc) {
  const secret = randomBytes(32).toString("base64url");
  const doc = await RefreshToken.create({
    user: user._id,
    tokenHash: sha256(secret),
    tokenVersion: user.tokenVersion,
    expiresAt: new Date(Date.now() + config.refreshTokenTtlSec * 1000),
  });
  return { token: `${doc._id}.${secret}`, id: doc._id };
}

const invalidSession = () => new AppError(401, "SESSION_EXPIRED", "Session expired, please log in again");

// Validates and rotates a refresh token. Reuse of a rotated token revokes all of the user's sessions.
export async function rotateRefreshToken(token: string | undefined) {
  const [id, secret] = (token || "").split(".");
  if (!id || !secret || !mongoose.isValidObjectId(id)) throw invalidSession();

  const doc = await RefreshToken.findById(id);
  if (!doc) throw invalidSession();

  const expected = Buffer.from(doc.tokenHash, "hex");
  const actual = Buffer.from(sha256(secret), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalidSession();

  if (doc.revokedAt) {
    await revokeAllSessions(doc.user);
    throw invalidSession();
  }

  const user = await User.findById(doc.user);
  if (!user || doc.expiresAt < new Date() || user.tokenVersion !== doc.tokenVersion) throw invalidSession();

  const next = await issueRefreshToken(user);
  doc.revokedAt = new Date();
  doc.replacedBy = next.id;
  await doc.save();

  return { user, refreshToken: next.token };
}

export async function revokeRefreshToken(token: string | undefined) {
  const [id] = (token || "").split(".");
  if (id && mongoose.isValidObjectId(id)) await RefreshToken.updateOne({ _id: id, revokedAt: null }, { revokedAt: new Date() });
}

// Logs the user out everywhere: old access tokens fail the tokenVersion check, refresh tokens are revoked.
export async function revokeAllSessions(userId: mongoose.Types.ObjectId | string) {
  await Promise.all([
    User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } }),
    RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() }),
  ]);
}

const baseCookie = (): CookieOptions => ({
  httpOnly: true,
  secure: config.cookies.secure,
  sameSite: config.cookies.sameSite,
  domain: config.cookies.domain,
});

export function setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie(), path: "/", maxAge: config.accessTokenTtlSec * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookie(), path: "/auth", maxAge: config.refreshTokenTtlSec * 1000 });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: "/auth" });
}
