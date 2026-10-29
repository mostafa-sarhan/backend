import { Request, Response } from "express";
import { ok } from "../../lib/respond";
import { cookieNames } from "./tokens";
import { loginBody, changePasswordBody } from "./auth.schemas";
import * as auth from "./auth.service";

const refreshCookie = (req: Request) => req.cookies?.[cookieNames("tenant").refresh];

export async function login(req: Request, res: Response) {
  const { email, password } = loginBody.parse(req.body);
  ok(res, await auth.login(req, res, email, password));
}

export async function refresh(req: Request, res: Response) {
  ok(res, await auth.refresh(res, refreshCookie(req)));
}

export async function logout(req: Request, res: Response) {
  await auth.logout(res, refreshCookie(req));
  ok(res, { loggedOut: true });
}

export function me(req: Request, res: Response) {
  const { id, email, role, mustChangePassword } = req.user!;
  ok(res, { user: { id, email, role, mustChangePassword: !!mustChangePassword }, tenant: auth.publicTenant(req.tenant!) });
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
  ok(res, await auth.changeOwnPassword(req, res, currentPassword, newPassword));
}
