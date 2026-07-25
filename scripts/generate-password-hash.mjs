import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error(
    'Usage: node scripts/generate-password-hash.mjs "your-password"',
  );
  process.exit(1);
}

const iterations = 210_000;
const salt = randomBytes(16);
const derived = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const base64url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

process.stdout.write(
  `pbkdf2-sha256$${iterations}$${base64url(salt)}$${base64url(derived)}\n`,
);
