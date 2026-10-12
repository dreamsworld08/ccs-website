// The rule for names of uploaded files (src/lib/upload-name.ts), and that the browser, the Apps Script backend and the
// local test server all apply the very same rule. Pure logic, no build needed.
//   npm run test:upload
import { readFileSync } from 'node:fs';
import { UPLOAD_NAME_RE, uploadName } from '../src/lib/upload-name.ts';

let pass = 0;
let fail = 0;
const check = (cond, name, extra = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` ${extra}`}`);
};

const NOW = 1791803973009;
const make = (f, ext = 'webp') => uploadName(f, ext, NOW);

check(
  make('WhatsApp Image 2026-10-06 at 12.21.36 (1).jpeg') ===
    'whatsapp-image-2026-10-06-at-12-21-36-1-1791803973009.webp',
  'a camera/WhatsApp file name becomes a clean slug',
);
check(
  make('Amit Sharma.PNG') === 'amit-sharma-1791803973009.webp',
  'capitals and the old extension are dropped',
);
check(make('notes.pdf', 'pdf') === 'notes-1791803973009.pdf', 'a PDF keeps the pdf extension');
check(
  make('') === 'file-1791803973009.webp' && make('***.jpg') === 'file-1791803973009.webp',
  'a name with nothing usable falls back to "file"',
);
check(make('दिल्ली.jpg') === 'file-1791803973009.webp', 'non-Latin names fall back to "file"');
const long = make(`${'a'.repeat(39)}-${'b'.repeat(40)}.jpg`);
check(
  !/--/.test(long) && UPLOAD_NAME_RE.test(long) && long.length <= 70,
  'a long name is cut without leaving a double hyphen',
  long,
);

const samples = [
  'x.png',
  'A B C.jpeg',
  '1.webp',
  'weird__name--here.JPG',
  'photo (2) final.png',
  '   .jpg',
  'a'.repeat(300) + '.png',
];
check(
  samples.every((f) => UPLOAD_NAME_RE.test(make(f)) && make(f).length <= 70),
  'every generated name passes the rule and fits the length limit',
);
check(
  make('a.png') !== uploadName('a.png', 'webp', NOW + 1),
  'two uploads of the same file a moment apart get different names',
);

for (const bad of [
  '../x-1791803973009.webp',
  'a/b-1791803973009.webp',
  'A-1791803973009.webp',
  'a--b-1791803973009.webp',
  'a-1791803973009.svg',
  'a-12345.webp',
  'a.webp',
  '-1791803973009.webp',
])
  check(!UPLOAD_NAME_RE.test(bad), `rejected: ${bad}`);

// One rule everywhere: the same pattern text must be in the backend and the local server.
const source = UPLOAD_NAME_RE.source;
const inGs = readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
const inDev = readFileSync(new URL('../dev-server/server.mjs', import.meta.url), 'utf8');
check(inGs.includes(`/${source}/`), 'Code.gs uses exactly this rule');
check(
  inDev.includes(`/${source}/`.replace(/\\/g, '\\')),
  'the local test server uses exactly this rule',
);

console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
