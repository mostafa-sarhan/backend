import { Request, Response } from "express";
import { ok, created } from "../../lib/respond";
import { idParams } from "../../lib/validate";
import { createUserBody, setPasswordBody, setRoleBody, auditLogQuery } from "./users.schemas";
import * as users from "./users.service";

export async function list(req: Request, res: Response) {
  ok(res, await users.listUsers(req));
}

export async function create(req: Request, res: Response) {
  created(res, await users.createUser(req, createUserBody.parse(req.body)));
}

export async function setPassword(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  ok(res, await users.setPassword(req, id, setPasswordBody.parse(req.body).newPassword));
}

export async function setRole(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  ok(res, await users.setRole(req, id, setRoleBody.parse(req.body).role));
}

export async function auditLogs(req: Request, res: Response) {
  const { items, meta } = await users.listAuditLogs(req, auditLogQuery.parse(req.query));
  ok(res, items, meta);
}
