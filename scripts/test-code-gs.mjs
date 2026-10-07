/* global doPost, doGet, setup, cleanContent_, CONTENT_RULES, CONFIG */
// Runs the REAL google-apps-script/Code.gs against in-memory fakes of the Apps Script services
// (Sheets, Cache, Lock, UrlFetch for the GitHub API, Utilities...). It cannot prove Google's
// runtime accepts every call, but it exercises all the business logic: validation, auth, token
// signing, stable row ids, GitHub commit/sha-conflict handling, upload checks, the fixed admin logins.
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
    setProperty: (k, v) => void (props[k] = String(v)),
    setProperties: (o) =>
      void Object.assign(
        props,
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])),
      ),
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
const sleeps = []; // every Utilities.sleep(ms) the script asks for (the slow-down after many wrong passwords)
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
  sleep: (ms) => void sleeps.push(ms),
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
/* Fake Instagram API (graph.instagram.com): one valid token, a fixed set of media, switchable failures */
const ig = { token: 'IGAAvalidtoken0123456789abcdef', media: [], down: false, calls: [] };
function instagram(url) {
  const u = new URL(url);
  ig.calls.push(u.pathname);
  if (ig.down) throw new Error(`DNS error for ${url}`); // UrlFetchApp throws when it cannot connect
  if (u.searchParams.get('access_token') !== ig.token)
    return resp(400, { error: { message: 'Invalid OAuth access token.', code: 190 } });
  if (u.pathname === '/me')
    return resp(200, { user_id: '1784', username: 'ccs_chandigarh', account_type: 'BUSINESS' });
  if (u.pathname === '/me/media') return resp(200, { data: ig.media });
  if (u.pathname === '/refresh_access_token') {
    ig.token = 'IGAArenewedtoken0123456789abcdef';
    return resp(200, { access_token: ig.token, token_type: 'bearer', expires_in: 5184000 });
  }
  return resp(404, {});
}
const route = (url, params) =>
  url.startsWith('https://graph.instagram.com/') ? instagram(url) : github(url, params);
globalThis.UrlFetchApp = {
  fetch: route,
  fetchAll: (reqs) => reqs.map((r) => route(r.url, r)),
};

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

console.log('\nfixed admin logins (set in Code.gs: nothing to set up, nothing to add)');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const codeText = readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
const shippedAdmins = CONFIG.ADMINS.map((a) => ({ ...a }));
check(
  shippedAdmins.length >= 1 &&
    shippedAdmins.every(
      (a) => a.login && a.name && /^[a-f0-9]{32}$/.test(a.salt) && /^[a-f0-9]{64}$/.test(a.hash),
    ),
  'each shippedAdmins login is a name plus a salted SHA-256 hash, never a password',
);
// The repository is public, so the hash is public. It is only safe because the password behind it is long and
// random: make sure it is not any password a person (or a cracking list) would try first.
const GUESSES = [
  'Admin@123',
  'admin',
  'Admin123',
  'Admin@1234',
  'admin123',
  'password',
  'Password1',
  'Password@123',
  '12345678',
  'qwerty123',
  'ccs@12345',
  'Ccs@12345',
  'ccs12345',
  'Chandigarh@123',
  'chandigarh',
  'ChandigarhCivilServices',
  'chandigarhcivilservices',
  'chandigarhcivilservices.com',
  'admin.ccs.chandigar',
  'Admin.CCS.Chandigar',
  'welcome123',
  'Welcome@123',
  'letmein',
  'iloveyou',
  'India@123',
  'Punjab@123',
];
check(
  shippedAdmins.every((a) => GUESSES.every((g) => sha(a.salt + g) !== a.hash)),
  'no shippedAdmins login uses a known or guessable password',
);
check(!codeText.includes('Admin@123'), 'Code.gs contains no default password');
check(
  shippedAdmins.every(
    (a, i) => shippedAdmins.findIndex((b) => b.login.toLowerCase() === a.login.toLowerCase()) === i,
  ),
  'logins are unique',
);

// From here on the tests use known throw-away logins instead of the real (secret) ones.
const TEST_PW = 'Test-only-password-9xK2mQ7pLw';
const STAFF_PW = 'Staff-only-password-4tR8vN3cZb';
const fixed = (login, name, password) => {
  const salt = createHash('md5').update(login).digest('hex');
  return { login, name, salt, hash: sha(salt + password) };
};
CONFIG.ADMINS = [
  fixed('admin.ccs.chandigar', 'CCS Admin', TEST_PW),
  fixed('staff.one', 'Staff One', STAFF_PW),
];

console.log('\nsetup()');
props.SHEET_ID = 'sheet-from-property';
setup(); // needs no admin properties: the logins are in the code
check(
  openedById === 'sheet-from-property',
  'SHEET_ID makes the script work on a sheet it is not bound to',
);
delete props.SHEET_ID;
check(
  ['Enquiries', 'Summary'].every((n) => sheets.has(n)),
  'creates the Enquiries and Summary tabs',
);
check(
  !sheets.has('Admins'),
  'there is no Admins tab: nobody can edit logins from the sheet either',
);
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
  !JSON.stringify([...sheets.values()].map((sh) => sh.rows)).includes(TEST_PW),
  'no password is written anywhere in the sheet',
);
setup();
check(sheets.get('Enquiries').rows[0][0] === 'Received (IST)', 'setup() is safe to re-run');

console.log('\nlogin + session tokens');
check(
  !call({ action: 'login', email: 'admin.ccs.chandigar', password: 'wrong' }).ok,
  'wrong password rejected',
);
check(
  !call({ action: 'login', email: 'admin.ccs.chandigar', password: 'Admin@123' }).ok,
  'the old published default password does not work',
);
const session = call({ action: 'login', email: 'Admin.CCS.Chandigar', password: TEST_PW });
check(
  session.ok &&
    session.name === 'CCS Admin' &&
    session.token.includes('.') &&
    session.must_change === undefined,
  'a fixed admin can log in (login is case-insensitive); there is no forced password change',
);
const T = session.token;
check(call({ action: 'listEnquiries' }).code === 'auth', 'no token rejected');
check(
  call({ action: 'listEnquiries', token: `${T.split('.')[0]}.${'0'.repeat(64)}` }).code === 'auth',
  'bad signature rejected',
);
const realNow = Date.now;
Date.now = () => realNow() + 13 * 3600 * 1000;
check(call({ action: 'listEnquiries', token: T }).code === 'auth', 'token expires after 12 hours');
Date.now = realNow;
// NO LOCK-OUT: wrong passwords never block anyone, not even a real admin (Google's slow answers make people retry).
sleeps.length = 0;
for (let i = 0; i < 10; i++)
  call({ action: 'login', email: 'admin.ccs.chandigar', password: `wrong-guess-${i}` });
check(
  sleeps.length === 0,
  'up to 10 wrong passwords are answered at once (an honest mistake or a few retries costs nothing)',
);
const afterMany = call({ action: 'login', email: 'admin.ccs.chandigar', password: TEST_PW });
check(
  afterMany.ok && afterMany.code !== 'locked',
  'the right password still works after many wrong ones: there is no lock-out',
);
for (let i = 0; i < 6; i++)
  call({ action: 'login', email: 'someone.else', password: `wrong-guess-${i}` });
for (let i = 0; i < 12; i++)
  call({ action: 'login', email: 'someone.else', password: `more-wrong-${i}` });
check(
  call({ action: 'login', email: 'someone.else', password: 'bad' }).code !== 'locked' &&
    sleeps.length > 0 &&
    sleeps.every((ms) => ms > 0 && ms <= 5000),
  'only a slow-down applies after more than 10 recent wrong attempts (each answered after a pause of at most 5 seconds)',
  JSON.stringify(sleeps.slice(0, 4)),
);
check(
  sleeps.at(-1) > sleeps[0],
  'the pause grows with each further wrong attempt',
  JSON.stringify(sleeps.slice(0, 4)),
);
// the pause only slows guessing: the correct password is never delayed or refused
sleeps.length = 0;
check(
  call({ action: 'login', email: 'admin.ccs.chandigar', password: TEST_PW }).ok &&
    sleeps.length === 0,
  'signing in with the right password is never slowed down',
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

console.log('\nfixed logins stay fixed');
const staff = call({ action: 'login', email: 'staff.one', password: STAFF_PW });
check(staff.ok && staff.name === 'Staff One', 'a second fixed login works');
check(
  call({ action: 'updateEnquiry', token: staff.token, row_id: target.row_id, notes: 'by staff' })
    .updated_by === 'Staff One',
  '"Updated by" records who made the change',
);
for (const action of ['listAdmins', 'addAdmin', 'setAdminActive', 'resetAdminPassword']) {
  const r = call({
    action,
    token: T,
    email: 'someone.new',
    name: 'Someone New',
    password: 'A-long-enough-password-12',
    old_password: TEST_PW,
    new_password: 'Another-long-password-34',
  });
  check(
    r.ok === false && /Unknown action/.test(r.error),
    `"${action}" does not exist: nobody can be added, removed or reset through the website`,
  );
}
check(
  !call({ action: 'login', email: 'someone.new', password: 'A-long-enough-password-12' }).ok,
  'a login that is not in the code cannot be made to work',
);
const everyone = CONFIG.ADMINS;
CONFIG.ADMINS = everyone.filter((a) => a.login !== 'staff.one');
check(
  call({ action: 'listEnquiries', token: staff.token }).code === 'auth',
  'an admin removed from the code loses access at once, even with a valid token',
);
check(
  !call({ action: 'login', email: 'staff.one', password: STAFF_PW }).ok,
  '...and cannot log in again',
);
CONFIG.ADMINS = everyone;
check(call({ action: 'listEnquiries', token: T }).ok, 'the remaining admin is not affected');
check(!call({ action: 'nope', token: T }).ok, 'unknown action rejected');
check(JSON.parse(doGet().text).ok, 'doGet health check');

console.log('\nInstagram live feed');
{
  const CDN = 'https://scontent-del1-1.cdninstagram.com/v/t51/abc.jpg?sig=1';
  const post = (n, extra = {}) => ({
    id: String(n),
    media_type: 'IMAGE',
    media_url: CDN,
    permalink: `https://www.instagram.com/p/AbCdEfG${n}/`,
    caption: `Caption ${n}`,
    timestamp: '2026-10-01T10:00:00+0000',
    ...extra,
  });
  ig.media = [
    post(1),
    post(2, {
      media_type: 'VIDEO',
      media_url: 'https://scontent.cdninstagram.com/v.mp4',
      thumbnail_url: CDN,
      permalink: 'https://www.instagram.com/reel/ReelCode22/',
    }),
    post(3, { media_type: 'CAROUSEL_ALBUM' }),
    post(4, { caption: `Line one\nline two\u0007 ${'x'.repeat(300)}` }),
    post(5, { permalink: 'javascript:alert(1)' }), // not an Instagram link: dropped
    post(6, { media_url: 'https://evil.example.com/a.jpg' }), // not Instagram's CDN: dropped
    post(7, { media_type: 'VIDEO', media_url: CDN, thumbnail_url: '' }), // a video with no cover: dropped
    post(8, { permalink: 'https://www.instagram.com/p/Ab/' }), // code too short: dropped
    post(9),
    post(10),
  ];
  const publicFeed = () => call({ action: 'instagramFeed' });
  const admin = (action, extra = {}) => call({ action, token: T, ...extra });
  const everything = []; // every response, to prove the token never leaves the backend
  const seen = (r) => (everything.push(JSON.stringify(r)), r);

  const none = publicFeed();
  check(
    none.ok && none.enabled === false && none.posts.length === 0,
    'before anything is connected the public feed is simply empty',
  );
  check(
    ig.calls.length === 0,
    'visitors never trigger an Instagram request when nothing is connected',
  );
  for (const a of [
    'getInstagram',
    'connectInstagram',
    'saveInstagramSettings',
    'refreshInstagram',
    'disconnectInstagram',
  ])
    check(call({ action: a }).code === 'auth', `${a} needs an admin session`);
  check(
    admin('getInstagram').connected === false,
    'the admin tab starts in the "not connected" state',
  );

  check(
    !admin('connectInstagram', { access_token: 'short' }).ok && ig.calls.length === 0,
    'something that is not a token is refused without calling Instagram',
  );
  const wrong = seen(
    admin('connectInstagram', { access_token: 'IGAAwrongtoken0123456789abcdefgh' }),
  );
  check(
    !wrong.ok && /no longer accepts/.test(wrong.error) && !props.IG_TOKEN,
    'a token Instagram rejects gives a plain-English error and is not stored',
    JSON.stringify(wrong),
  );

  const linked = seen(admin('connectInstagram', { access_token: ` ${ig.token}\n` }));
  check(
    linked.ok &&
      linked.connected &&
      linked.username === 'ccs_chandigarh' &&
      linked.account_type === 'BUSINESS',
    'a valid token connects the account (spaces and line breaks from pasting are ignored)',
    JSON.stringify(linked),
  );
  check(props.IG_TOKEN === ig.token, 'the token is kept in Script Properties');
  check(
    linked.enabled === true,
    'the feed is switched on by default the first time an account is connected',
  );
  check(
    linked.days_left >= 59 && linked.expiry_estimated === true,
    'the status shows about 60 days left, marked as an estimate until the first renewal',
    JSON.stringify(linked),
  );

  const feed = seen(publicFeed());
  check(
    feed.ok &&
      feed.enabled &&
      feed.username === 'ccs_chandigarh' &&
      feed.profile_url === 'https://www.instagram.com/ccs_chandigarh/',
    'the public feed names the account and links to its profile',
    JSON.stringify(feed),
  );
  check(
    feed.posts.length === 6 &&
      feed.posts.map((x) => x.code).join() ===
        'AbCdEfG1,ReelCode22,AbCdEfG3,AbCdEfG4,AbCdEfG9,AbCdEfG10',
    'only well-formed posts with an Instagram link and picture survive',
    feed.posts.map((x) => x.code).join(),
  );
  check(
    feed.posts[1].kind === 'reel' && feed.posts[1].video === true && feed.posts[1].image === CDN,
    'a reel uses its cover picture and is flagged as a video',
  );
  check(
    // eslint-disable-next-line no-control-regex -- the point is that control characters are gone
    feed.posts[3].caption.length <= 140 && !/[\n\u0007]/.test(feed.posts[3].caption),
    'captions are cut to 140 characters with no line breaks or control characters',
  );
  check(
    feed.posts.every((x) => Object.keys(x).sort().join() === 'caption,code,image,kind,ts,video'),
    'each post carries only the fields the page needs',
  );

  ig.calls.length = 0;
  publicFeed();
  publicFeed();
  check(
    ig.calls.length === 0,
    'repeat visits within 15 minutes are served from the cache (no Instagram request)',
  );

  const few = seen(
    admin('saveInstagramSettings', { enabled: 'true', count: 3, heading: '  Follow\nus  ' }),
  );
  check(
    few.ok && few.count === 3 && few.heading === 'Follow us',
    'settings save, with the heading tidied',
    JSON.stringify(few),
  );
  check(
    publicFeed().posts.length === 3 && publicFeed().heading === 'Follow us',
    'a changed count and heading apply at once, without waiting for the cache',
  );
  for (const bad of [2, 13, 'many', 4.5])
    check(
      !admin('saveInstagramSettings', { enabled: 'true', count: bad, heading: 'x' }).ok,
      `${bad} posts is refused`,
    );
  check(
    admin('saveInstagramSettings', { enabled: 'true', count: 6, heading: ''.padEnd(5, ' ') })
      .heading === 'Latest from our Instagram',
    'an empty heading falls back to the default',
  );
  admin('saveInstagramSettings', { enabled: 'false', count: 6, heading: 'Hidden' });
  const off = seen(publicFeed());
  check(
    off.enabled === false && off.posts.length === 0 && !('username' in off),
    'switched off: the public feed is empty again',
  );
  admin('saveInstagramSettings', { enabled: 'true', count: 6, heading: 'Latest' });

  // --- trouble with Instagram
  cacheStore.delete('ig:fresh');
  ig.down = true;
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  ig.calls.length = 0;
  const stale = seen(publicFeed());
  console.warn = realWarn;
  check(
    stale.ok && stale.posts.length === 6,
    'if Instagram is unreachable the last good copy is shown (visitors see no error)',
  );
  check(
    !warnings.join('\n').includes(ig.token),
    'the log never contains the access token (it travels in the request URL)',
    warnings.join('|'),
  );
  check(
    /Could not reach/.test(admin('getInstagram').last_error),
    'the admin tab shows what went wrong',
  );
  const callsAfterFailure = ig.calls.length;
  publicFeed();
  publicFeed();
  check(
    ig.calls.length === callsAfterFailure,
    'after a failure Instagram is not hammered: it is left alone for a couple of minutes',
  );
  ig.down = false;
  cacheStore.delete('ig:backoff');
  cacheStore.delete('ig:fresh');
  check(
    publicFeed().posts.length === 6 && admin('getInstagram').last_error === '',
    'it recovers by itself when Instagram is back',
  );

  cacheStore.delete('ig:posts');
  cacheStore.delete('ig:fresh');
  ig.down = true;
  console.warn = () => {};
  const empty = publicFeed();
  console.warn = realWarn;
  check(
    empty.posts.length === 0,
    'with no copy at all and Instagram down, the feed is empty rather than an error',
  );
  ig.down = false;
  cacheStore.delete('ig:backoff');

  // --- the connection renews itself
  ig.calls.length = 0;
  props.IG_REFRESHED = String(Date.now() - 11 * 24 * 3600 * 1000);
  cacheStore.delete('ig:fresh');
  publicFeed();
  check(
    ig.calls.includes('/refresh_access_token') &&
      props.IG_TOKEN === ig.token &&
      props.IG_EXPIRES_EXACT === 'true',
    'a token older than 10 days is renewed quietly while visitors use the site',
    ig.calls.join(),
  );
  check(
    admin('getInstagram').expiry_estimated === false,
    'after a renewal the expiry date is exact',
  );
  ig.calls.length = 0;
  cacheStore.delete('ig:fresh');
  publicFeed();
  check(!ig.calls.includes('/refresh_access_token'), 'a fresh token is not renewed again');

  ig.calls.length = 0;
  const forced = seen(admin('refreshInstagram'));
  check(
    forced.ok && ig.calls.includes('/me/media') && forced.posts.length === 6,
    '"Refresh now" reloads from Instagram straight away',
  );

  const gone = seen(admin('disconnectInstagram'));
  check(
    gone.ok &&
      !props.IG_TOKEN &&
      !props.IG_USERNAME &&
      !props.IG_EXPIRES &&
      admin('getInstagram').connected === false,
    'disconnecting forgets the token and the account',
  );
  check(
    publicFeed().posts.length === 0 && !cacheStore.has('ig:posts'),
    'and clears the cached posts',
  );
  check(!everything.some((r) => r.includes('IGAA')), 'no response ever contained an access token');
}

console.log('\nchange my password (private, and it ends every other session)');
{
  const NEW_PW = 'Brand-new-pass-77x';
  const RESET_PW = 'Developer-reset-pw-31q';
  const a = call({ action: 'login', email: 'admin.ccs.chandigar', password: TEST_PW });
  const other = call({ action: 'login', email: 'admin.ccs.chandigar', password: TEST_PW }); // a second session
  const change = (patch, token = a.token) =>
    call({
      action: 'changePassword',
      token,
      old_password: TEST_PW,
      new_password: NEW_PW,
      ...patch,
    });
  check(!change({ old_password: 'wrong-current-pw' }).ok, 'needs the current password');
  for (const [label, patch] of [
    ['too short', { new_password: 'Ab1xyz' }],
    ['eleven characters', { new_password: 'Abcdefgh123' }],
    ['one character repeated', { new_password: '111111111111' }],
    ['all letters', { new_password: 'OnlyLettersHere' }],
    ['all digits', { new_password: '1234567890123' }],
    ['the same as the current one', { new_password: TEST_PW }],
    ['containing the login', { new_password: 'admin.ccs.chandigar-9' }],
  ]) {
    check(!change(patch).ok, `rejects a new password that is ${label}`);
  }
  check(
    call({ action: 'login', email: 'admin.ccs.chandigar', password: TEST_PW }).ok,
    'nothing changed after the rejections',
  );

  const changed = change({});
  check(
    changed.ok && changed.token && changed.token !== a.token,
    'changes the password and returns a fresh session',
  );
  check(
    call({ action: 'listEnquiries', token: changed.token }).ok,
    'the session that changed it keeps working',
  );
  check(
    call({ action: 'listEnquiries', token: a.token }).code === 'auth' &&
      call({ action: 'listEnquiries', token: other.token }).code === 'auth',
    'every other session ends when the password changes (even the one that made the change, with its old token)',
  );
  check(
    !call({ action: 'login', email: 'admin.ccs.chandigar', password: TEST_PW }).ok &&
      call({ action: 'login', email: 'admin.ccs.chandigar', password: NEW_PW }).ok,
    'the old password stops working and the new one works',
  );
  const stored = Object.entries(props).filter(([k]) => k.startsWith('ADMINPW_'));
  check(
    stored.length === 1 &&
      !JSON.stringify(props).includes(NEW_PW) &&
      /^[0-9a-f]{64}$/.test(JSON.parse(stored[0][1]).hash),
    'it is stored in Script Properties as a salted hash, never in plain text',
  );
  check(
    !JSON.stringify([...sheets.values()].map((sh) => sh.rows)).includes(NEW_PW) &&
      !codeText.includes(NEW_PW),
    'and it is nowhere in the sheet or the code',
  );
  check(
    call({ action: 'login', email: 'staff.one', password: STAFF_PW }).ok,
    'another admin is not affected',
  );

  // A forgotten password: the developer replaces the hash in the code, and the chosen password is ignored.
  const kept = CONFIG.ADMINS;
  CONFIG.ADMINS = kept.map((x) =>
    x.login === 'admin.ccs.chandigar' ? fixed(x.login, x.name, RESET_PW) : x,
  );
  check(
    !call({ action: 'login', email: 'admin.ccs.chandigar', password: NEW_PW }).ok &&
      call({ action: 'login', email: 'admin.ccs.chandigar', password: RESET_PW }).ok,
    'replacing the hash in the code resets a forgotten password (the chosen one is ignored)',
  );
  check(
    call({ action: 'listEnquiries', token: changed.token }).code === 'auth',
    '...and ends the sessions that were open',
  );
  CONFIG.ADMINS = kept;

  // Wrong "current password" guesses never lock anything either; they only count towards the same slow-down.
  const b = call({ action: 'login', email: 'staff.one', password: STAFF_PW });
  for (let i = 0; i < 8; i++)
    call({
      action: 'changePassword',
      token: b.token,
      old_password: 'guess-' + i,
      new_password: 'Another-pass-2024',
    });
  const stillWorks = call({
    action: 'changePassword',
    token: b.token,
    old_password: STAFF_PW,
    new_password: 'Another-pass-2024',
  });
  check(
    stillWorks.ok && stillWorks.code !== 'locked',
    'many wrong "current password" guesses do not lock the change-password form or the login',
  );
}

console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
