import bcrypt from "bcryptjs";
import { AppError } from "../../lib/errors";
import { config } from "../../config";

export const isBcryptHash = (value: string) => /^\$2[aby]\$\d{2}\$/.test(value);

// Policy: 10+ characters, at most 72 bytes (bcrypt limit), at least one letter and one digit,
// and not the email address.
export function passwordProblems(password: string, email?: string): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push("At least 10 characters");
  if (Buffer.byteLength(password, "utf8") > 72) problems.push("At most 72 bytes");
  if (!/\p{L}/u.test(password)) problems.push("At least one letter");
  if (!/\d/.test(password)) problems.push("At least one digit");
  if (email && password.toLowerCase().includes(email.toLowerCase().split("@")[0])) {
    problems.push("Must not contain the email name");
  }
  return problems;
}

export function assertStrongPassword(password: string, email?: string) {
  const problems = passwordProblems(password, email);
  if (problems.length) throw new AppError(400, "WEAK_PASSWORD", "Password does not meet the policy", problems);
}

export const hashPassword = (password: string) => bcrypt.hash(password, config.bcryptRounds);
export const verifyPassword = (password: string, hash: string) =>
  isBcryptHash(hash) ? bcrypt.compare(password, hash) : Promise.resolve(false);
export const needsRehash = (hash: string) => bcrypt.getRounds(hash) < config.bcryptRounds;
