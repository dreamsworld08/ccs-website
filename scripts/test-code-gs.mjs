/* global doPost, doGet, setup, cleanContent_, CONTENT_RULES */
// Runs the REAL google-apps-script/Code.gs against in-memory fakes of the Apps Script services
// (Sheets, Cache, Lock, UrlFetch for the GitHub API, Utilities...). It cannot prove Google's
// runtime accepts every call, but it exercises all the business logic: validation, auth, token
// signing, stable row ids, GitHub commit/sha-conflict handling, upload checks, admin management.
//   npm run test:gs
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0;
let fail = 0;
const ok = (n) => {
  pass++;
  console.log(`  ok   ${n}`);
};
const bad = (n, x = '') => {
  fail++;
  console.log(`  FAIL ${n} ${x}`);
};
const check = (c, n, x) => (c ? ok(n) : bad(n, x));

/* ------------------------------------------------------------------ fakes */
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (arr) => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b)));
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : unsigned(v));

const chain = () =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === 'build' ? () => ({}) : k === 'then' ? undefined : chain()),
    apply: () => chain(),
  });

function makeSheet(name) {
  const sheet = {
    name,
    rows: [],
    hidden: false,
    getName: () => name,
    getLastRow: () => {
      for (let i = sheet.rows.length - 1; i >= 0; i--)
        if ((sheet.rows[i] || []).some((v) => v !== undefined && v !== '')) return i + 1;
      return 0;
    },
    getMaxRows: () => 1000,
    insertRowBefore(n) {
      sheet.rows.splice(n - 1, 0, []);
      return sheet;
    },
    appendRow(arr) {
      sheet.rows[sheet.getLastRow()] = [...arr];
      return sheet;
    },
    clear() {
      sheet.rows = [];
      return sheet;
    },
    getFilter: () => null,
    hideSheet() {
      sheet.hidden = true;
      return sheet;
    },
    protect: () => ({
      setDescription() {
        return this;
      },
      getEditors: () => [],
      removeEditors() {
        return this;
      },
      canDomainEdit: () => false,
      setDomainEdit() {
        return this;
      },
    }),
    getRange(a, b, c, d) {
      let r,
        col,
        nr = 1,
        nc = 1;
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d+)$/);
        col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        r = Number(m[2]);
      } else {
        r = a;
        col = b;
        nr = c ?? 1;
        nc = d ?? 1;
      }
      const get = (i, j) => (sheet.rows[r - 1 + i] || [])[col - 1 + j];
      const range = {
        getRow: () => r,
        getValues: () =>
          Array.from({ length: nr }, (_, i) =>
            Array.from({ length: nc }, (_, j) => get(i, j) ?? ''),
          ),
        setValues(vals) {
          vals.forEach((row, i) =>
            row.forEach((v, j) => {
              (sheet.rows[r - 1 + i] ||= [])[col - 1 + j] = v;
            }),
          );
          return range;
        },
        setValue(v) {
          (sheet.rows[r - 1] ||= [])[col - 1] = v;
          return range;
        },
        setFormula() {
          return range;
        },
        createTextFinder: (text) => ({
          matchEntireCell() {
            return this;
          },
          findNext() {
            for (let i = 0; i < nr; i++)
              if (String(get(i, 0) ?? '') === text) return { getRow: () => r + i };
            return null;
          },
        }),
      };
      for (const m of [
        'setNumberFormat',
        'setFontWeight',
        'setBackground',
        'setFontColor',
        'setDataValidation',
        'createFilter',
        'setNote',
      ])
        range[m] = () => range;
      return range;
    },
  };
  for (const m of [
    'setFrozenRows',
    'setColumnWidths',
    'setColumnWidth',
    'setConditionalFormatRules',
  ])
    sheet[m] = () => sheet;
  return sheet;
}

const sheets = new Map();
const spreadsheet = {
  getSheetByName: (n) => sheets.get(n) ?? null,
  insertSheet: (n) => {
    const s = makeSheet(n);
    sheets.set(n, s);
    return s;
  },
  setSpreadsheetTimeZone() {},
  getSheets: () => [...sheets.values()],
  deleteSheet(s) {
    sheets.delete(s.name);
  },
};
let openedById = '';
globalThis.SpreadsheetApp = {
  getActiveSpreadsheet: () => spreadsheet,
  openById: (id) => {
    openedById = id;
    return spreadsheet;
  },
  flush() {},
  newDataValidation: chain,
  newConditionalFormatRule: chain,
};

const props = {
  SIGNING_SECRET: 'unit-test-signing-secret-0123456789abcdef',
  GITHUB_TOKEN: 'ghp_fake',
  GITHUB_REPO: 'acme/ccs-website',
};
globalThis.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    deleteProperty: (k) => void delete props[k],
  }),
};
const cacheStore = new Map();
globalThis.CacheService = {
  getScriptCache: () => ({
    get: (k) => cacheStore.get(k) ?? null,
    put: (k, v) => void cacheStore.set(k, v),
    remove: (k) => void cacheStore.delete(k),
  }),
};
globalThis.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
globalThis.MailApp = { sendEmail() {} };
globalThis.Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
globalThis.ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: (s) => ({
    text: s,
    setMimeType() {
      return this;
    },
  }),
};
globalThis.Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' },
  Charset: { UTF_8: 'utf8' },
  computeDigest: (_alg, s) => signed(createHash('sha256').update(toBuf(s)).digest()),
  computeHmacSha256Signature: (v, key) =>
    signed(createHmac('sha256', key).update(toBuf(v)).digest()),
  base64EncodeWebSafe: (s) =>
    Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64DecodeWebSafe: (s) =>
    signed(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  base64Encode: (v) => toBuf(v).toString('base64'),
  base64Decode: (s) => {
    if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error('Invalid base64');
    return signed(Buffer.from(s, 'base64'));
  },
  newBlob: (bytes) => ({ getDataAsString: () => unsigned(bytes).toString('utf8') }),
  getUuid: () => randomUUID(),
  formatDate: (d) => {
    const s = d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T');
    return `${s}+05:30`;
  },
};

/* Fake GitHub Contents API: path -> { content(base64), sha } */
const repo = new Map();
const commits = [];
let shaCounter = 0;
const resp = (code, body) => ({
  getResponseCode: () => code,
  getContentText: () => JSON.stringify(body),
});
function github(url, params = {}) {
  const u = new URL(url);
  const m = u.pathname.match(/^\/repos\/acme\/ccs-website\/contents\/(.+)$/);
  if (!m) return resp(404, {});
  if (params.headers?.Authorization !== 'Bearer ghp_fake')
    return resp(401, { message: 'Bad credentials' });
  const path = decodeURIComponent(m[1]);
  const method = (params.method || 'get').toLowerCase();
  const body = params.payload ? JSON.parse(params.payload) : {};
  if (method === 'get') {
    if (repo.has(path))
      return resp(200, { type: 'file', name: path.split('/').pop(), path, ...repo.get(path) });
    const dir = [...repo.keys()].filter((p) => p.startsWith(`${path}/`));
    if (!dir.length) return resp(404, { message: 'Not Found' });
    return resp(
      200,
      dir.map((p) => ({ type: 'file', name: p.split('/').pop(), path: p, sha: repo.get(p).sha })),
    );
  }
  const existing = repo.get(path);
  if (method === 'put') {
    if (existing && body.sha !== existing.sha)
      return resp(body.sha ? 409 : 422, { message: 'sha mismatch' });
    if (!existing && body.sha) return resp(409, { message: 'not found' });
    const sha = `sha${++shaCounter}`;
    repo.set(path, { content: body.content, sha });
    commits.push({ path, message: body.message, branch: body.branch });
    return resp(existing ? 200 : 201, { content: { sha } });
  }
  if (method === 'delete') {
    if (!existing) return resp(404, {});
    if (body.sha !== existing.sha) return resp(409, {});
    repo.delete(path);
    commits.push({ path, message: body.message, deleted: true });
    return resp(200, {});
  }
  return resp(405, {});
}
globalThis.UrlFetchApp = { fetch: github, fetchAll: (reqs) => reqs.map((r) => github(r.url, r)) };

/* ------------------------------------------------------------------ load the real script */
const code = readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
vm.runInThisContext(code, { filename: 'Code.gs' });

const call = (params) => JSON.parse(doPost({ parameter: params }).text);
const form = {
  name: 'Test Student',
  mobile: '9876500001',
  exam: 'UPSC CSE',
  year: '2027',
  source: 'popup',
};
const putRepoFile = (path, obj) =>
  repo.set(`src/content/${path}`, {
    content: Buffer.from(JSON.stringify(obj, null, 2)).toString('base64'),
    sha: `seed${++shaCounter}`,
  });

/* ------------------------------------------------------------------ tests */
console.log('content lock is generated from the admin schema');
let rulesStale = '';
try {
  execFileSync('node', ['scripts/content-rules.mjs', '--check'], { stdio: 'pipe' });
} catch (e) {
  rulesStale = String(e.stderr || e);
}
check(
  !rulesStale,
  'google-apps-script/content-rules.json and the Code.gs block are up to date',
  rulesStale,
);

console.log('\nsetup()');
let refused = '';
try {
  setup();
} catch (e) {
  refused = String(e.message);
}
check(
  /FIRST_ADMIN_LOGIN/.test(refused) && sheets.get('Admins').getLastRow() <= 1,
  'setup() refuses to create an admin without Script Properties (there is no default login)',
  refused,
);
Object.assign(props, {
  FIRST_ADMIN_LOGIN: 'Admin.CCS.Chandigar',
  FIRST_ADMIN_PASSWORD: 'Initial#Pass1',
  FIRST_ADMIN_NAME: 'CCS Admin',
  SHEET_ID: 'sheet-from-property',
});
setup();
check(
  openedById === 'sheet-from-property',
  'SHEET_ID makes the script work on a sheet it is not bound to',
);
delete props.SHEET_ID;
check(
  ['Enquiries', 'Admins', 'Summary'].every((n) => sheets.has(n)),
  'creates Enquiries, Admins and Summary tabs',
);
check(sheets.get('Admins').hidden, 'Admins tab is hidden');
check(
  sheets
    .get('Enquiries')
    .rows[0].join('|')
    .startsWith(
      'Received (IST)|Name|Mobile|Email|Exam|Year of attempt|City|Message|Source|UTM source',
    ),
  'Enquiries headers match the spec',
);
check(
  sheets.get('Admins').rows[1][0] === 'admin.ccs.chandigar' &&
    sheets.get('Admins').rows[1][3].length === 64,
  'first admin comes from the Script Properties and is stored as a SHA-256 hash',
);
check(
  !JSON.stringify(sheets.get('Admins').rows).includes('Initial#Pass1'),
  'plaintext password is nowhere in the sheet',
);
check(props.FIRST_ADMIN_PASSWORD === undefined, 'the password property is deleted after setup');
check(
  !readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8').includes(
    'Admin@123',
  ),
  'Code.gs contains no default password',
);
setup();
check(sheets.get('Admins').getLastRow() === 2, 'setup() is safe to re-run (no duplicate admin)');

console.log('\nlogin + session tokens');
check(
  !call({ action: 'login', email: 'admin.ccs.chandigar', password: 'wrong' }).ok,
  'wrong password rejected',
);
check(
  !call({ action: 'login', email: 'admin.ccs.chandigar', password: 'Admin@123' }).ok,
  'the old published default password does not work',
);
const session = call({ action: 'login', email: 'Admin.CCS.Chandigar', password: 'Initial#Pass1' });
check(
  session.ok && session.name === 'CCS Admin' && session.token.includes('.'),
  'the first admin can log in (login is case-insensitive)',
);
check(
  session.must_change === false,
  'the developer chose this password, so there is no forced change',
);
check(
  !call({
    action: 'changePassword',
    token: session.token,
    old_password: 'Initial#Pass1',
    new_password: 'Initial#Pass1',
  }).ok,
  'new password must differ from the old one',
);
check(
  !call({
    action: 'changePassword',
    token: session.token,
    old_password: 'Initial#Pass1',
    new_password: 'short',
  }).ok,
  'weak new password refused',
);
const login2 = session;
const T = login2.token;
check(call({ action: 'listEnquiries' }).code === 'auth', 'no token rejected');
check(
  call({ action: 'listEnquiries', token: `${T.split('.')[0]}.${'0'.repeat(64)}` }).code === 'auth',
  'bad signature rejected',
);
const realNow = Date.now;
Date.now = () => realNow() + 13 * 3600 * 1000;
check(call({ action: 'listEnquiries', token: T }).code === 'auth', 'token expires after 12 hours');
Date.now = realNow;
for (let i = 0; i < 5; i++) call({ action: 'login', email: 'someone', password: 'bad' });
check(
  call({ action: 'login', email: 'someone', password: 'bad' }).code === 'locked',
  'locks out after 5 failed logins',
);

console.log('\nsubmitEnquiry');
check(call({ ...form, action: 'submitEnquiry' }).ok, 'valid enquiry accepted');
let enq = sheets.get('Enquiries');
check(
  enq.rows[1][1] === 'Test Student' && enq.rows[1][12] === 'Open' && enq.rows[1][8] === 'popup',
  'inserted at row 2 with Status=Open and source',
);
check(
  call({ ...form, action: 'submitEnquiry' }).code === 'duplicate',
  'same mobile within 10 minutes is a duplicate',
);
check(
  call({
    ...form,
    action: 'submitEnquiry',
    mobile: '9876500002',
    name: 'Second',
    source: 'lp:upsc-scholarship-test-2027',
  }).ok &&
    enq.rows[1][1] === 'Second' &&
    enq.rows[2][1] === 'Test Student',
  'newest enquiry goes on top',
);
check(
  call({ ...form, action: 'submitEnquiry', mobile: '9876500003', website: 'spam' }).ok &&
    enq.getLastRow() === 3,
  'honeypot hit stores nothing',
);
for (const [label, patch] of [
  ['short name', { name: 'A' }],
  ['bad mobile', { mobile: '1234567890' }],
  ['bad email', { email: 'nope' }],
  ['bad exam', { exam: 'Hacking' }],
  ['missing exam', { exam: '' }],
  ['malformed year', { year: '20x7' }],
]) {
  check(
    !call({ ...form, action: 'submitEnquiry', mobile: '9876500009', ...patch }).ok,
    `rejects ${label}`,
  );
}
check(
  call({
    action: 'submitEnquiry',
    name: 'Signup Person',
    mobile: '9876500004',
    exam: 'Other',
    source: 'exam_updates_signup',
  }).ok,
  'exam_updates_signup needs no year',
);
check(
  call({
    action: 'submitEnquiry',
    name: 'Three Fields',
    mobile: '9876500011',
    exam: 'Punjab PSC (PCS)',
    source: 'popup',
  }).ok &&
    enq.rows[1][1] === 'Three Fields' &&
    enq.rows[1][5] === '' &&
    enq.rows[1][3] === '',
  'name + mobile + exam is enough: year, email, city and message are optional',
);
check(
  call({
    ...form,
    action: 'submitEnquiry',
    mobile: '9876500012',
    name: 'Everything',
    email: 'a@b.co',
    city: 'Mohali',
    message: 'Call after 6',
  }).ok &&
    enq.rows[1][3] === 'a@b.co' &&
    enq.rows[1][5] === '2027' &&
    enq.rows[1][6] === 'Mohali' &&
    enq.rows[1][7] === 'Call after 6',
  'optional fields are stored when they are given',
);
call({
  ...form,
  action: 'submitEnquiry',
  mobile: '9876500005',
  name: '=HYPERLINK("http://evil")',
  message: '@SUM(1)',
});
check(
  enq.rows[1][1].startsWith("'=") && enq.rows[1][7].startsWith("'@"),
  'formula-like values are neutralised before reaching the sheet',
);
check(
  call({ ...form, action: 'submitEnquiry', mobile: '9876500006', name: 'x'.repeat(500) }).ok &&
    enq.rows[1][1].length <= 60,
  'over-long fields are clipped server-side',
);
// eslint-disable-next-line no-control-regex -- the test looks for control characters on purpose
const HAS_CONTROL = /[\r\n\u0000]/;
check(
  call({
    ...form,
    action: 'submitEnquiry',
    mobile: '9876500010',
    name: 'Eve\r\nBcc: attacker@evil.test',
    message: 'line1\nline2\u0000',
  }).ok && !HAS_CONTROL.test(enq.rows[1][1] + enq.rows[1][7]),
  'newlines and control characters are stripped (no email-header or CSV-row injection)',
);

console.log('\nlistEnquiries + updateEnquiry (stable ids)');
const list = call({ action: 'listEnquiries', token: T });
check(
  list.ok && list.rows.length === 8 && list.rows.every((r) => r.row_id),
  'returns rows with ids',
);
check(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/.test(list.rows[0].received),
  'received is ISO in IST',
  list.rows[0].received,
);
const target = list.rows.find((r) => r.name === 'Test Student');
call({ ...form, action: 'submitEnquiry', mobile: '9876500007', name: 'Late arrival' }); // shifts every row down by one
const up = call({
  action: 'updateEnquiry',
  token: T,
  row_id: target.row_id,
  status: 'Contacted',
  notes: 'Called at 5pm',
});
check(up.ok && up.updated_by === 'CCS Admin', 'update succeeds');
const after = call({ action: 'listEnquiries', token: T }).rows;
const t2 = after.find((r) => r.row_id === target.row_id);
check(
  t2.status === 'Contacted' && t2.notes === 'Called at 5pm' && t2.name === 'Test Student',
  'update hit the right row even though new rows were inserted meanwhile',
);
check(after.filter((r) => r.status === 'Contacted').length === 1, 'no other row changed');
check(
  !call({ action: 'updateEnquiry', token: T, row_id: target.row_id, status: 'Hacked' }).ok,
  'invalid status rejected',
);
check(
  !call({ action: 'updateEnquiry', token: T, row_id: 'nope', status: 'Open' }).ok,
  'unknown id rejected',
);

console.log('\ncontent via GitHub');
const course = (o = {}) => ({
  name: 'A',
  price: '1',
  category: 'UPSC CSE',
  thumbnail: '',
  published: true,
  ...o,
});
putRepoFile('courses/a-course.json', course());
putRepoFile('courses/b-course.json', course({ name: 'B', price: '2' }));
const lc = call({ action: 'listContent', token: T, folder: 'courses' });
check(
  lc.ok && lc.items.length === 2 && lc.items[0].data.name === 'A' && lc.items[0].sha,
  'listContent returns files with data and sha',
);
check(
  call({ action: 'listContent', token: T, folder: 'secrets' }).ok === false,
  'listContent rejects unknown folders',
);
check(
  call({
    action: 'saveContent',
    token: T,
    path: 'reels/aman-gill.json',
    json: JSON.stringify({
      instagram_url: 'https://www.instagram.com/reel/AbCdEfGh123/',
      student_name: 'Aman',
    }),
    sha: '',
  }).ok,
  'saves into the reels folder',
);
check(
  call({ action: 'listContent', token: T, folder: 'tests' }).items.length === 0,
  'empty folder returns no items',
);
const gc = call({ action: 'getContent', token: T, path: 'courses/a-course.json' });
check(gc.ok && gc.data.price === '1', 'getContent reads one file');
const saved = call({
  action: 'saveContent',
  token: T,
  path: 'courses/a-course.json',
  json: JSON.stringify(course({ price: '9' })),
  sha: gc.sha,
});
check(saved.ok && saved.sha !== gc.sha, 'saveContent updates with the current sha');
check(
  commits.at(-1).message === 'admin: CCS Admin updated courses/a-course.json' &&
    commits.at(-1).branch === 'main',
  'commit message and branch as specified',
);
const stale = call({
  action: 'saveContent',
  token: T,
  path: 'courses/a-course.json',
  json: JSON.stringify(course({ price: '5' })),
  sha: gc.sha,
});
check(
  stale.code === 'conflict' && stale.current.data.price === '9',
  'stale sha returns a conflict with the latest version',
);
check(
  call({
    action: 'saveContent',
    token: T,
    path: 'courses/new-one.json',
    json: JSON.stringify(course({ name: 'N' })),
    sha: '',
  }).ok,
  'creates a new file when no sha is given',
);
check(
  call({
    action: 'saveContent',
    token: T,
    path: 'courses/new-one.json',
    json: JSON.stringify(course({ name: 'N2' })),
    sha: '',
  }).code === 'conflict',
  'creating over an existing file is a conflict',
);
for (const path of [
  '../x.json',
  'courses/../../x.json',
  'courses/x.txt',
  'secrets/x.json',
  '/courses/x.json',
  'courses/Bad Name.json',
  'courses/.json',
]) {
  check(
    !call({ action: 'saveContent', token: T, path, json: '{}', sha: '' }).ok,
    `saveContent rejects "${path}"`,
  );
}
check(
  !call({ action: 'saveContent', token: T, path: 'courses/x.json', json: '[1]', sha: '' }).ok,
  'rejects non-object JSON',
);
check(
  !call({ action: 'saveContent', token: T, path: 'courses/x.json', json: '{"a":', sha: '' }).ok,
  'rejects invalid JSON',
);
check(
  !call({
    action: 'saveContent',
    token: T,
    path: 'courses/x.json',
    json: '{"constructor":1}',
    sha: '',
  }).ok,
  'rejects prototype-pollution keys',
);
check(
  !call({
    action: 'saveContent',
    token: T,
    path: 'landing-pages/abc.json',
    json: '{"slug":"zzz"}',
    sha: '',
  }).ok,
  'landing slug must match file name',
);
check(
  !call({
    action: 'saveContent',
    token: T,
    path: 'courses/big.json',
    json: JSON.stringify({ a: 'x'.repeat(70000) }),
    sha: '',
  }).ok,
  'rejects oversized JSON',
);
const del = call({
  action: 'deleteContent',
  token: T,
  path: 'courses/b-course.json',
  sha: lc.items[1].sha,
});
check(
  del.ok && !repo.has('src/content/courses/b-course.json') && commits.at(-1).deleted,
  'deleteContent removes the file with a commit',
);
check(
  call({ action: 'deleteContent', token: T, path: 'courses/a-course.json', sha: 'stale' }).code ===
    'conflict',
  'delete with a stale sha is a conflict',
);

console.log('\nthe lock: the admin can change content, never layout or features');
const saveAs = (path, obj, sha = '') =>
  call({ action: 'saveContent', token: T, path, json: JSON.stringify(obj), sha });
const stored = (path) =>
  JSON.parse(Buffer.from(repo.get(`src/content/${path}`).content, 'base64').toString('utf8'));
const settings = {
  phone: '+91 98765 43210',
  whatsapp_number: '919876543210',
  email: 'info@example.in',
  address: 'SCO 1, Chandigarh',
  map_url: '',
  youtube_url: '',
  instagram_url: '',
  telegram_url: '',
  attempt_years: ['2027', '2028'],
};

putRepoFile('settings/site.json', { ...settings, show_free_tests: false });
let cur = call({ action: 'getContent', token: T, path: 'settings/site.json' });
check(
  saveAs('settings/site.json', { ...settings, show_free_tests: true }, cur.sha).ok &&
    stored('settings/site.json').show_free_tests === false,
  'the admin cannot switch on a developer-only feature (Free Tests): the stored value is kept',
);
putRepoFile('settings/site.json', { ...settings, show_free_tests: true }); // the developer turns it on in git
cur = call({ action: 'getContent', token: T, path: 'settings/site.json' });
check(
  saveAs('settings/site.json', { ...settings, phone: '+91 90000 00000' }, cur.sha).ok &&
    stored('settings/site.json').show_free_tests === true &&
    stored('settings/site.json').phone === '+91 90000 00000',
  'an ordinary settings save keeps the developer switch as it was (and saves the phone number)',
);
cur = call({ action: 'getContent', token: T, path: 'settings/site.json' });
check(
  saveAs('settings/site.json', { ...settings, show_free_tests: false }, cur.sha).ok &&
    stored('settings/site.json').show_free_tests === true,
  'the admin cannot switch it off either',
);
check(
  saveAs('settings/other.json', settings).error?.includes('fixed file name'),
  'settings and home are single files: no extra copies can be added',
);
check(
  call({ action: 'deleteContent', token: T, path: 'settings/site.json', sha: cur.sha }).ok ===
    false && repo.has('src/content/settings/site.json'),
  'settings/site.json cannot be deleted (the site could not be built without it)',
);
putRepoFile('home/home.json', { hero_headline: 'Hello' });
check(
  call({
    action: 'deleteContent',
    token: T,
    path: 'home/home.json',
    sha: call({ action: 'getContent', token: T, path: 'home/home.json' }).sha,
  }).ok === false,
  'home/home.json cannot be deleted either',
);

const c1 = saveAs('courses/lock-test.json', course({ name: 'Lock' }));
check(c1.ok, 'a valid course saves');
check(
  saveAs('courses/lock-extra.json', course({ layout: 'wide', css: 'x{}', html: '<b>x</b>' })).ok &&
    JSON.stringify(Object.keys(stored('courses/lock-extra.json')).sort()) ===
      JSON.stringify(Object.keys(course()).sort()),
  'fields the admin screen does not have (layout, css, html...) are dropped, not stored',
);
check(
  saveAs('courses/lock-cat.json', course({ category: 'Test series' })).ok &&
    saveAs(
      'courses/lock-cat.json',
      course({ category: 'Optional' }),
      call({ action: 'getContent', token: T, path: 'courses/lock-cat.json' }).sha,
    ).ok &&
    stored('courses/lock-cat.json').category === 'Test series',
  'a course category is set once: later requests cannot change it',
);
for (const [label, patch] of [
  ['over-long text', { name: 'x'.repeat(71) }],
  ['an option that does not exist', { category: 'Hacking' }],
  ['a missing required field', { price: '' }],
  ['a javascript: link in an image field', { thumbnail: 'javascript:alert(1)' }],
  ['a picture hosted elsewhere', { thumbnail: 'https://evil.example/x.png' }],
  ['a path that climbs out of uploads', { thumbnail: '/uploads/../src/pages/index.astro' }],
  ['a number where text is expected', { price: 5 }],
  ['text where on/off is expected', { published: 'yes' }],
]) {
  check(!saveAs('courses/lock-bad.json', course(patch)).ok, `rejects ${label}`);
}
check(
  !repo.has('src/content/courses/lock-bad.json'),
  'nothing from a rejected save reaches GitHub',
);
check(
  !saveAs('reels/lock-reel.json', {
    instagram_url: 'https://example.com/not-instagram',
    student_name: 'X',
  }).ok,
  'a reel must be an Instagram link',
);
check(
  !saveAs('home/home.json', {
    hero_headline: 'Hi',
    hero_btn1_label: 'a',
    hero_btn2_label: 'b',
    hero_btn2_link: 'javascript:alert(1)',
    founder_name: 'F',
    founder_headline: 'H',
    cta_headline: 'C',
  }).ok,
  'a javascript: button link on the Home page is refused',
);
check(
  saveAs('landing-pages/lock-lp.json', {
    slug: 'lock-lp',
    internal_name: 'LP',
    published: false,
    show_on_main_site: false,
    hero_headline: 'Head',
    hero_bullets: ['a', 'b', 'c'],
    default_exam: 'UPSC CSE',
    benefits: [],
    faqs: [],
    show_toppers: false,
    cta_button_label: 'Go',
  }).ok &&
    !saveAs('landing-pages/lock-lp2.json', {
      slug: 'lock-lp2',
      internal_name: 'LP',
      hero_headline: 'Head',
      hero_bullets: ['a', 'b', 'c', 'd'],
      default_exam: 'UPSC CSE',
    }).ok,
  'list sizes are capped (a landing page has at most 3 tick points)',
);
check(
  !saveAs('landing-pages/Not_Valid.json', {
    slug: 'Not_Valid',
    internal_name: 'x',
    hero_headline: 'h',
    default_exam: 'UPSC CSE',
  }).ok,
  'landing page addresses are lowercase letters, numbers and hyphens only',
);

// Every sample item that ships with the site must pass the lock unchanged, otherwise the admin
// panel could not save it. This also catches the admin form and the lock drifting apart.
const SRC = new URL('../src/content/', import.meta.url);
const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys(v[k])]),
        )
      : v;
let shipped = 0;
const drift = [];
for (const dir of readdirSync(SRC)) {
  for (const file of readdirSync(new URL(`${dir}/`, SRC)).filter((f) => f.endsWith('.json'))) {
    const original = JSON.parse(readFileSync(new URL(`${dir}/${file}`, SRC), 'utf8'));
    // developer-only keys are allowed to be present in the file but are not part of the admin form
    const result = cleanContent_(CONTENT_RULES, `${dir}/${file}`, original, original);
    shipped++;
    if (!result.ok) drift.push(`${dir}/${file}: ${result.error}`);
    else if (JSON.stringify(sortKeys(result.data)) !== JSON.stringify(sortKeys(original)))
      drift.push(`${dir}/${file}: the lock would change it`);
  }
}
check(
  drift.length === 0 && shipped > 40,
  `all ${shipped} shipped content files pass the lock unchanged`,
  drift.join(' | '),
);

console.log('\nuploadFile');
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(40),
]).toString('base64');
const up1 = call({
  action: 'uploadFile',
  token: T,
  folder: 'courses',
  filename: 'My Photo (1).PNG',
  base64: webp,
});
check(
  up1.ok &&
    /^\/uploads\/courses\/my-photo-1-\d+\.webp$/.test(up1.path) &&
    repo.has(`public${up1.path}`),
  'WebP accepted, name sanitised, committed under public/uploads',
  up1.path,
);
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100)]).toString('base64');
check(
  call({ action: 'uploadFile', token: T, folder: 'resources', filename: 'notes.pdf', base64: pdf })
    .ok,
  'PDF accepted in resources',
);
check(
  !call({ action: 'uploadFile', token: T, folder: 'teachers', filename: 'notes.pdf', base64: pdf })
    .ok,
  'PDF refused outside resources',
);
check(
  !call({
    action: 'uploadFile',
    token: T,
    folder: 'courses',
    filename: 'x.webp',
    base64: Buffer.from('<svg onload=alert(1)>').toString('base64'),
  }).ok,
  'SVG/HTML disguised as WebP refused (checked by file bytes)',
);
check(
  !call({ action: 'uploadFile', token: T, folder: '../../', filename: 'x.webp', base64: webp }).ok,
  'upload folder allow-list enforced',
);
check(
  !call({
    action: 'uploadFile',
    token: T,
    folder: 'courses',
    filename: 'x.webp',
    base64: '@@@not base64@@@',
  }).ok,
  'garbage base64 refused',
);

console.log('\nadmin management');
check(
  call({ action: 'addAdmin', token: T, email: 'staff1', name: 'Staff One', password: 'short' })
    .ok === false,
  'weak password refused',
);
check(
  call({ action: 'addAdmin', token: T, email: 'staff1', name: 'Staff One', password: 'Staff1pass' })
    .ok,
  'add admin',
);
check(
  !call({ action: 'addAdmin', token: T, email: 'STAFF1', name: 'Dup', password: 'Staff1pass' }).ok,
  'duplicate login refused',
);
const s2a = call({ action: 'login', email: 'staff1', password: 'Staff1pass' });
check(
  s2a.ok && s2a.name === 'Staff One' && s2a.must_change === true,
  'new admin can log in but must replace the temporary password',
);
check(
  call({ action: 'updateEnquiry', token: s2a.token, row_id: target.row_id, notes: 'x' }).code ===
    'must_change',
  'temporary password cannot do anything else',
);
check(
  call({
    action: 'changePassword',
    token: s2a.token,
    old_password: 'Staff1pass',
    new_password: 'Staff2pass',
  }).ok,
  'new admin chooses their own password',
);
const s2 = call({ action: 'login', email: 'staff1', password: 'Staff2pass' });
check(s2.ok && s2.must_change === false, 'then works normally');
check(
  call({ action: 'updateEnquiry', token: s2.token, row_id: target.row_id, notes: 'by staff' })
    .updated_by === 'Staff One',
  '"Updated by" records who made the change',
);
check(
  !JSON.stringify(sheets.get('Admins').rows).includes('Staff1pass'),
  'new admin password stored only as hash',
);
check(
  call({ action: 'setAdminActive', token: T, email: 'staff1', active: 'false' }).ok,
  'deactivate admin',
);
check(
  call({ action: 'listEnquiries', token: s2.token }).code === 'auth',
  'deactivated admin loses access immediately, even with a valid token',
);
check(
  !call({ action: 'login', email: 'staff1', password: 'Staff2pass' }).ok,
  'deactivated admin cannot log in',
);
call({ action: 'setAdminActive', token: T, email: 'staff1', active: 'true' });
check(
  call({ action: 'resetAdminPassword', token: T, email: 'staff1', password: 'Newpass99' }).ok &&
    call({ action: 'login', email: 'staff1', password: 'Newpass99' }).must_change === true,
  'reset password (and the person must replace the temporary one)',
);
check(
  !call({ action: 'changePassword', token: T, old_password: 'wrong', new_password: 'Another123' })
    .ok,
  'changePassword needs the current password',
);
check(
  call({
    action: 'changePassword',
    token: T,
    old_password: 'Initial#Pass1',
    new_password: 'Another123',
  }).ok &&
    call({ action: 'login', email: 'admin.ccs.chandigar', password: 'Another123' }).ok &&
    !call({ action: 'login', email: 'admin.ccs.chandigar', password: 'Initial#Pass1' }).ok,
  'changePassword switches the login',
);
call({ action: 'setAdminActive', token: T, email: 'staff1', active: 'false' });
check(
  call({ action: 'setAdminActive', token: T, email: 'admin.ccs.chandigar', active: 'false' }).ok ===
    false,
  'cannot deactivate the last active admin',
);
check(!call({ action: 'nope', token: T }).ok, 'unknown action rejected');
check(JSON.parse(doGet().text).ok, 'doGet health check');

console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
