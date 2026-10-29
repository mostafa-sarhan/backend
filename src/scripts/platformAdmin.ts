// Create a platform admin, or reset their password:  npm run platform-admin -- admin@example.com
// The generated password is printed once.
import { config } from "../config";
import { connectDb, disconnectDb } from "../db";
import { PlatformAdmin } from "../modules/platform/platformAdmin.model";
import { hashPassword } from "../modules/auth/password";
import { generateInitialPassword } from "../modules/platform/platform.service";
import { str } from "../lib/validate";

async function main() {
  const email = str.email.parse(process.argv[2]);
  await connectDb(config.mongoUri);
  const password = generateInitialPassword();
  const existing = await PlatformAdmin.findOne({ email });
  if (existing) {
    existing.password = await hashPassword(password);
    existing.mustChangePassword = true;
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
