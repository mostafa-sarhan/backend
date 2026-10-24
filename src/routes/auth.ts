import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { User, publicUser } from "../models/User";
import { AppError } from "../lib/errors";
import { ok } from "../lib/respond";
import { str } from "../lib/validate";
import { verifyPassword, needsRehash, hashPassword } from "../lib/password";
import {
  REFRESH_COOKIE,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  setSessionCookies,
  clearSessionCookies,
} from "../lib/tokens";
import { requireAuth } from "../middleware/auth";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many login attempts, try again later")),
});

const loginBody = z.object({ email: str.email, password: z.string().min(1).max(200) });

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = loginBody.parse(req.body);

  const user = await User.findOne({ email });
  // Same response for unknown email and wrong password, so emails can't be probed.
  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  if (needsRehash(user.password)) {
    user.password = await hashPassword(password);
    await user.save();
  }

  const { token: refreshToken } = await issueRefreshToken(user);
  setSessionCookies(res, signAccessToken(user), refreshToken);
  ok(res, { user: publicUser(user) });
});

router.post("/refresh", async (req, res) => {
  try {
    const { user, refreshToken } = await rotateRefreshToken(req.cookies?.[REFRESH_COOKIE]);
    setSessionCookies(res, signAccessToken(user), refreshToken);
    ok(res, { user: publicUser(user) });
  } catch (err) {
    clearSessionCookies(res);
    throw err;
  }
});

router.post("/logout", async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  clearSessionCookies(res);
  ok(res, { loggedOut: true });
});

router.get("/me", requireAuth, (req, res) => {
  ok(res, { user: req.user });
});

export default router;
