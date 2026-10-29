import jwt from "jsonwebtoken";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Response, CookieOptions } from "express";
import mongoose from "mongoose";
import { config } from "../config";
import { RefreshToken, Realm } from "../models/RefreshToken";
import { User } from "../models/User";
import { PlatformAdmin } from "../models/PlatformAdmin";
import { AppError } from "./errors";

// Two separate session realms with their own cookies, paths and JWT audience:
// tenant users (app) and platform admins (/platform). A token from one is useless in the other.
const ALGORITHM = "HS256";
const ISSUER = "shipping-api";

const REALM_CONFIG: Record<Realm, { access: string; refresh: string; accessPath: string; refreshPath: string }> = {
  tenant: { access: "access_token", refresh: "refresh_token", accessPath: "/", refreshPath: "/auth" },
  platform: { access: "platform_access", refresh: "platform_refresh", accessPath: "/platform", refreshPath: "/platform/auth" },
};
export const cookieNames = (realm: Realm) => REALM_CONFIG[realm];

export interface Subject {
  _id: mongoose.Types.ObjectId;
  tokenVersion: number;
  role?: string;
  tenantId?: mongoose.Types.ObjectId | null;
}

export interface AccessPayload {
  sub: string;
  tv: number;
  role?: string;
  tid?: string;
}

export const signAccessToken = (realm: Realm, s: Subject) =>
  jwt.sign(
    { tv: s.tokenVersion, ...(s.role && { role: s.role }), ...(s.tenantId && { tid: s.tenantId.toString() }) },
    config.jwtSecret,
    { algorithm: ALGORITHM, expiresIn: config.accessTokenTtlSec, issuer: ISSUER, audience: realm, subject: s._id.toString() }
  );

export function verifyAccessToken(realm: Realm, token: string): AccessPayload {
  return jwt.verify(token, config.jwtSecret, { algorithms: [ALGORITHM], issuer: ISSUER, audience: realm }) as AccessPayload;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Refresh token format: "<documentId>.<random secret>". Only the secret's hash is stored.
export async function issueRefreshToken(realm: Realm, s: Subject) {
  const secret = randomBytes(32).toString("base64url");
  const doc = await RefreshToken.create({
    realm,
    subject: s._id,
    tenantId: s.tenantId ?? null,
    tokenHash: sha256(secret),
    tokenVersion: s.tokenVersion,
    expiresAt: new Date(Date.now() + config.refreshTokenTtlSec * 1000),
  });
  return { token: `${doc._id}.${secret}`, id: doc._id };
}

const invalidSession = () => new AppError(401, "SESSION_EXPIRED", "Session expired, please log in again");

const REUSE_GRACE_MS = 20_000;

const loadSubject = (realm: Realm, id: mongoose.Types.ObjectId, tenantId?: mongoose.Types.ObjectId | null) =>
  realm === "tenant" ? User.findOne({ _id: id, tenantId }) : PlatformAdmin.findById(id);

// Validates and rotates a refresh token. Reuse of a rotated token revokes all of the subject's sessions.
export async function rotateRefreshToken(realm: Realm, token: string | undefined) {
  const [id, secret] = (token || "").split(".");
  if (!id || !secret || !mongoose.isValidObjectId(id)) throw invalidSession();

  const doc = await RefreshToken.findById(id);
  if (!doc || doc.realm !== realm) throw invalidSession();

  const expected = Buffer.from(doc.tokenHash, "hex");
  const actual = Buffer.from(sha256(secret), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalidSession();

  // A token rotated a few seconds ago is a concurrent refresh (two tabs, a reload mid-refresh),
  // not theft. Older reuse means the token leaked: revoke every session.
  const concurrent = doc.revokedAt && doc.replacedBy && Date.now() - doc.revokedAt.getTime() < REUSE_GRACE_MS;
  if (doc.revokedAt && !concurrent) {
    await revokeAllSessions(realm, doc.subject, doc.tenantId);
    throw invalidSession();
  }

  const subject = await loadSubject(realm, doc.subject, doc.tenantId);
  if (!subject || doc.expiresAt < new Date() || subject.tokenVersion !== doc.tokenVersion) throw invalidSession();

  const next = await issueRefreshToken(realm, subject as Subject);
  if (!concurrent) {
    doc.revokedAt = new Date();
    doc.replacedBy = next.id;
    await doc.save();
  }

  return { subject, refreshToken: next.token };
}

export async function revokeRefreshToken(token: string | undefined) {
  const [id] = (token || "").split(".");
  if (id && mongoose.isValidObjectId(id)) await RefreshToken.updateOne({ _id: id, revokedAt: null }, { revokedAt: new Date() });
}

// Logs the subject out everywhere: old access tokens fail the tokenVersion check, refresh tokens are revoked.
export async function revokeAllSessions(realm: Realm, subjectId: mongoose.Types.ObjectId | string, tenantId?: mongoose.Types.ObjectId | string | null) {
  const bump =
    realm === "tenant"
      ? User.updateOne({ _id: subjectId, tenantId }, { $inc: { tokenVersion: 1 } })
      : PlatformAdmin.updateOne({ _id: subjectId }, { $inc: { tokenVersion: 1 } });
  await Promise.all([bump, RefreshToken.updateMany({ realm, subject: subjectId, revokedAt: null }, { revokedAt: new Date() })]);
}

// Suspending a tenant ends every session of its users.
export async function revokeTenantSessions(tenantId: mongoose.Types.ObjectId | string) {
  await Promise.all([
    User.updateMany({ tenantId }, { $inc: { tokenVersion: 1 } }),
    RefreshToken.updateMany({ realm: "tenant", tenantId, revokedAt: null }, { revokedAt: new Date() }),
  ]);
}

const baseCookie = (): CookieOptions => ({
  httpOnly: true,
  secure: config.cookies.secure,
  sameSite: config.cookies.sameSite,
  domain: config.cookies.domain,
});

export function setSessionCookies(res: Response, realm: Realm, accessToken: string, refreshToken: string) {
  const c = REALM_CONFIG[realm];
  res.cookie(c.access, accessToken, { ...baseCookie(), path: c.accessPath, maxAge: config.accessTokenTtlSec * 1000 });
  res.cookie(c.refresh, refreshToken, { ...baseCookie(), path: c.refreshPath, maxAge: config.refreshTokenTtlSec * 1000 });
}

export function clearSessionCookies(res: Response, realm: Realm) {
  const c = REALM_CONFIG[realm];
  res.clearCookie(c.access, { ...baseCookie(), path: c.accessPath });
  res.clearCookie(c.refresh, { ...baseCookie(), path: c.refreshPath });
}

