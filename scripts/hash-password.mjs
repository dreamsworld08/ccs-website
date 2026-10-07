// Makes a fixed admin login for CONFIG.ADMINS in google-apps-script/Code.gs.
//
//   npm run hash -- --generate [login] [name]       make a long random password (recommended)
//   npm run hash -- 'YourLongPassword' [login] [name]   hash a password you chose (at least 16 characters)
//
// Prints a ready-to-paste entry (only the salted hash) and, with --generate, the password: it is shown ONCE, so
// save it in a password manager straight away. Add the entry to CONFIG.ADMINS, then deploy a new version of the
// Apps Script. The repository is public, so only the hash is ever stored; a short or guessable password could be
// cracked offline from it, which is why short passwords are refused here.
import { createHash, randomBytes, randomInt } from 'node:crypto';

const args = process.argv.slice(2);
const generate = args[0] === '--generate';
const [first, login = 'admin.ccs.chandigar', name = 'CCS Admin'] = generate
  ? ['', ...args.slice(1)]
  : args;

// No look-alike characters (0 O 1 l I) so the password can be read from a screen without mistakes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const makePassword = () => {
  let pw;
  do pw = Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  while (!/[A-Za-z]/.test(pw) || !/\d/.test(pw));
  return pw;
};

const password = generate ? makePassword() : first;
if (!password) {
  console.error(
    "Usage: npm run hash -- --generate [login] [name]\n   or: npm run hash -- 'YourLongPassword' [login] [name]",
  );
  process.exit(1);
}
if (password.length < 16) {
  console.error(
    'That password is too short. Admin hashes are stored in a public repository, so use at least 16 characters,\nor let this script make one:  npm run hash -- --generate',
  );
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = createHash('sha256')
  .update(salt + password)
  .digest('hex');
const esc = (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

console.log(
  'Paste this into CONFIG.ADMINS in google-apps-script/Code.gs, then deploy a new version:\n',
);
console.log(`    { login: '${esc(login)}', name: '${esc(name)}',`);
console.log(`      salt: '${salt}',`);
console.log(`      hash: '${hash}' }`);
if (generate)
  console.log(
    `\nLogin:    ${login}\nPassword: ${password}\n(shown once: save it in a password manager now)`,
  );
