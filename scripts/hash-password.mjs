// Prints a salted SHA-256 credential in the format used by the Admins sheet and the local dev backend:
//   password_hash = sha256Hex(salt + password)
// Usage: npm run hash -- 'MyPassword1'
import { createHash, randomBytes } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash -- '<password>'");
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const hash = createHash('sha256')
  .update(salt + password)
  .digest('hex');
console.log(JSON.stringify({ salt, password_hash: hash }, null, 2));
