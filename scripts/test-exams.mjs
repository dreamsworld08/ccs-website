// The exam list (IAS, PCS, HPAS, HCS) lives in src/lib/exams.ts. Code.gs and the local test server cannot import it, so
// they carry a copy: this fails if any copy drifts, and checks the helper that reads old and new names.
//   npm run test:exams
import { readFileSync } from 'node:fs';
import { EXAM_NAMES, EXAMS, LEGACY_EXAMS, OFFERED_EXAMS, examName } from '../src/lib/exams.ts';

let pass = 0;
let fail = 0;
const check = (cond, name, extra = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` ${extra}`}`);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const listIn = (source, pattern) => {
  const m = source.match(pattern);
  return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : null;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('the list itself');
check(same(OFFERED_EXAMS, ['IAS', 'PCS', 'HPAS', 'HCS']), 'the four exams, in this order');
check(
  same(EXAMS, ['IAS', 'PCS', 'HPAS', 'HCS', 'Other']),
  'forms offer the four exams and "Other"',
);
check(
  OFFERED_EXAMS.every((e) => EXAM_NAMES[e]),
  'every exam has a full name',
);

console.log('\nthe copies agree');
const gs = read('google-apps-script/Code.gs');
const dev = read('dev-server/server.mjs');
const gsExams = listIn(gs, /var EXAMS = \[([^\]]*)\]/);
const gsLegacy = listIn(gs, /var LEGACY_EXAMS = \[([^\]]*)\]/);
const devExams = listIn(dev, /const EXAMS = \[([^\]]*)\]/);
const devLegacy = listIn(dev, /const LEGACY_EXAMS = \[([^\]]*)\]/);
check(same(gsExams, EXAMS), 'Code.gs EXAMS matches', JSON.stringify(gsExams));
check(same(devExams, EXAMS), 'the local test server EXAMS matches', JSON.stringify(devExams));
check(
  gsLegacy && same(gsLegacy, devLegacy),
  'Code.gs and the local server accept the same older names',
  JSON.stringify([gsLegacy, devLegacy]),
);
check(
  gsLegacy?.every((n) => n in LEGACY_EXAMS),
  'every older name the backend accepts is known to the site',
);

console.log('\nthe fallback for an older backend');
const fallback = read('src/lib/enquiry.ts').match(/OLD_BACKEND_EXAM[^=]*= \{([^}]*)\}/)?.[1] ?? '';
const pairs = [...fallback.matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]]);
check(
  pairs.length === 2 &&
    pairs.every(([from, to]) => OFFERED_EXAMS.includes(from) && gsLegacy?.includes(to)),
  'IAS and PCS are re-sent under names the older backend accepts',
  JSON.stringify(pairs),
);
check(
  pairs.every(([from, to]) => LEGACY_EXAMS[to] === from),
  'and those names map back to the same exams',
);

console.log('\nreading old and new names');
check(
  ['IAS', 'PCS', 'HPAS', 'HCS', 'Other'].every((e) => examName(e) === e),
  "today's names are returned as they are",
);
check(
  examName('UPSC CSE') === 'IAS' &&
    examName('Punjab PSC (PCS)') === 'PCS' &&
    examName('Punjab PSC') === 'PCS',
  'older UPSC / Punjab names become IAS / PCS',
);
check(
  examName('Optional') === 'IAS' && examName('Test series') === 'IAS',
  'the older course categories "Optional" and "Test series" belong to IAS',
);
check(
  examName('UPSC') === 'IAS' &&
    examName('PPSC') === 'PCS' &&
    examName('PSSSB') === 'Other' &&
    examName('Punjab Police') === 'Other',
  'an exam update filed under its older issuing body (UPSC, PPSC...) reads as the exam it belongs to',
);
check(
  examName('Punjab One Day Exams') === 'Other' && examName('Punjab One Day') === 'Other',
  'one-day exams are no longer offered: they become "Other"',
);
check(
  ['', 'ias', 'Patwari', null, undefined].every((v) => examName(v) === ''),
  'anything else is not one of ours',
);
check(examName('  HPAS ') === 'HPAS', 'stray spaces are ignored');

console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
