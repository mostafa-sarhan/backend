// Create a platform admin, or reset their password:  npm run platform-admin -- admin@example.com
// The generated password is printed once.
import { config } from "../config";
import { connectDb, disconnectDb } from "../db";
import { PlatformAdmin } from "../models/PlatformAdmin";
import { hashPassword } from "../lib/password";
import { generateInitialPassword } from "../services/platform";
import { str } from "../lib/validate";

async function main() {
  const email = str.email.parse(process.argv[2]);
  await connectDb(config.mongoUri);
  const password = generateInitialPassword();
  const existing = await PlatformAdmin.findOne({ email });
  if (existing) {
    existing.password = await hashPassword(password);
    existing.tokenVersion += 1;
    await existing.save();
  } else {
    await PlatformAdmin.create({ email, password: await hashPassword(password) });
  }
  process.stdout.write(`${existing ? "Password reset" : "Created"} for ${email}\nPassword (shown once): ${password}\n`);
}

main()
  .catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
