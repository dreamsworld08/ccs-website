/**
 * Local stand-in for the Google Apps Script backend (google-apps-script/Code.gs).
 * Same API, same rules, so the site and /admin behave identically in development:
 *   - enquiries are stored in dev-server/data/enquiries.json (instead of a Google Sheet)
 *   - admins live in dev-server/data/admins.json (instead of the "Admins" tab)
 *   - content edits and uploads are written straight to src/content and public/uploads
 *     (instead of being committed to GitHub), so `astro dev` shows them instantly.
 * Zero dependencies. Binds to 127.0.0.1 only.
 */
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanContent } from '../google-apps-script/content-lock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'dev-server', 'data');
const CONTENT = join(ROOT, 'src', 'content');
const UPLOADS = join(ROOT, 'public', 'uploads');
const PORT = Number(process.env.PORT || 8787);

/* ------------------------------------------------------------------ constants */
const STATUSES = ['Open', 'Contacted', 'Resolved', 'Enrolled'];
const CONTENT_FOLDERS = [
  'settings',
  'home',
  'courses',
  'teachers',
  'results',
  'reels',
  'resources',
  'exam-updates',
  'landing-pages',
  'tests',
];
const UPLOAD_FOLDERS = [
  'courses',
  'teachers',
  'results',
  'reels',
  'resources',
  'home',
  'founder',
  'landing-pages',
  'misc',
];
const PATH_RE = new RegExp(`^(${CONTENT_FOLDERS.join('|')})/[a-z0-9][a-z0-9_-]{0,80}\\.json$`);
const EXAMS = ['UPSC CSE', 'Punjab PSC (PCS)', 'Punjab One Day Exams', 'Other'];
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 9 * 1024 * 1024;
const MAX_JSON_BYTES = 60 * 1024;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
// What the admin panel may write: generated from src/admin/schemas.ts by `npm run rules`.
const CONTENT_RULES = JSON.parse(
  await readFile(join(ROOT, 'google-apps-script', 'content-rules.json'), 'utf8'),
);

/* ------------------------------------------------------------------ helpers */
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (secret, s) => createHmac('sha256', secret).update(s).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
/** Trim, drop control characters (newlines would break CSV rows and email headers) and cap the length. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;
const clip = (v, n) =>
  String(v ?? '')
    .replace(CONTROL_CHARS, ' ')
    .trim()
    .slice(0, n);
/** Cells starting with = + - @ are treated as formulas by spreadsheets: neutralise them. */
const noFormula = (v) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const istNow = () => {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }); // 2026-10-05 19:31:00
  return `${s.replace(' ', 'T')}+05:30`;
};
const json = (res, status, body, origin) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(body));
};
const corsHeaders = (origin) =>
  origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      }
    : {};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
/** Atomic write: a crash mid-save can never leave a half-written file. */
async function writeAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}
/** Resolve a user-supplied relative path under a base directory; null when it escapes. */
function within(base, rel) {
  const full = resolve(base, rel);
  return full === base || full.startsWith(base + sep) ? full : null;
}

/* ------------------------------------------------------------------ secrets & state */
await mkdir(DATA, { recursive: true });
const SECRET_FILE = join(DATA, '.secret');
let SECRET = process.env.SIGNING_SECRET;
if (!SECRET) {
  if (!existsSync(SECRET_FILE))
    await writeFile(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
  SECRET = (await readFile(SECRET_FILE, 'utf8')).trim();
}
const ADMINS_FILE = join(DATA, 'admins.json');
const ENQ_FILE = join(DATA, 'enquiries.json');

// Local development only (this server listens on 127.0.0.1): the first start creates a throwaway admin
// in the git-ignored admins.json. Production never has a default login, see google-apps-script/SETUP.md.
if (!existsSync(ADMINS_FILE)) {
  const salt = randomBytes(16).toString('hex');
  const password = process.env.DEV_ADMIN_PASSWORD || 'Admin@123';
  await writeFile(
    ADMINS_FILE,
    JSON.stringify(
      [
        {
          email: 'admin.ccs.chandigar',
          name: 'CCS Admin',
          salt,
          password_hash: createHash('sha256')
            .update(salt + password)
            .digest('hex'),
          active: true,
        },
      ],
      null,
      2,
    ),
  );
  console.log('[dev-api] created dev-server/data/admins.json (local login only)');
}

let enquiries = await readJson(ENQ_FILE, null);
if (enquiries === null) {
  enquiries = seedEnquiries();
  await writeAtomic(ENQ_FILE, JSON.stringify(enquiries, null, 2));
  console.log(
    `[dev-api] seeded ${enquiries.length} demo enquiries (delete dev-server/data/enquiries.json to reset)`,
  );
}

function seedEnquiries() {
  const names = [
    'Aman Gill',
    'Simran Kaur',
    'Karan Mehta',
    'Jaspreet Dhillon',
    'Harleen Sidhu',
    'Manpreet Brar',
    'Rohit Sharma',
    'Pooja Rani',
    'Gagandeep Singh',
    'Navjot Kaur',
    'Ankit Chauhan',
    'Divya Thakur',
    'Sukhdeep Singh',
    'Ritika Bansal',
  ];
  const cities = [
    'Chandigarh',
    'Mohali',
    'Ludhiana',
    'Amritsar',
    'Patiala',
    'Ambala',
    'Shimla',
    'Panchkula',
    '',
  ];
  const sources = [
    '/',
    '/courses/',
    '/results/',
    'popup',
    'popup',
    'exam_updates_signup',
    'lp:upsc-scholarship-test-2027',
    'lp:upsc-scholarship-test-2027',
  ];
  const statuses = ['Open', 'Open', 'Open', 'Contacted', 'Contacted', 'Resolved', 'Enrolled'];
  const years = ['2027', '2028', '2029'];
  const rows = [];
  for (let i = 0; i < 28; i++) {
    const ago = Math.floor(i * 1.45 * 24 * 3600 * 1000 + (i % 5) * 3_600_000);
    const d = new Date(Date.now() - ago);
    const s = d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T') + '+05:30';
    const source = sources[i % sources.length];
    const status = statuses[(i * 3) % statuses.length];
    rows.push({
      id: `demo${String(i + 1).padStart(3, '0')}`,
      received: s,
      name: names[i % names.length],
      mobile: `${['98', '97', '70', '62'][i % 4]}${String(10000000 + ((i * 7919) % 89999999)).slice(0, 8)}`,
      email: i % 3 === 0 ? `student${i + 1}@example.com` : '',
      exam: EXAMS[i % 3 === 2 ? 2 : i % 2],
      year: source === 'exam_updates_signup' ? '' : years[i % 3],
      city: cities[i % cities.length],
      message: i % 4 === 0 ? 'Please call after 6 pm.' : '',
      source,
      utm_source: source.startsWith('lp:') ? 'google' : '',
      utm_medium: source.startsWith('lp:') ? 'cpc' : '',
      utm_campaign: source.startsWith('lp:') ? 'scholarship-oct' : '',
      status,
      notes: status === 'Contacted' ? 'Called once, will visit centre.' : '',
      last_updated: status === 'Open' ? '' : s,
      updated_by: status === 'Open' ? '' : 'CCS Admin',
    });
  }
  return rows; // already newest first
}

/* ------------------------------------------------------------------ admins & sessions */
async function loadAdmins() {
  return readJson(ADMINS_FILE, []);
}
const adminPublic = (a) => ({
  email: a.email,
  name: a.name,
  active: a.active,
  must_change: Boolean(a.must_change),
});
const failed = new Map(); // email -> [timestamps]
function lockedOut(email) {
  const now = Date.now();
  const list = (failed.get(email) ?? []).filter((t) => now - t < 15 * 60 * 1000);
  failed.set(email, list);
  return list.length >= 5;
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 100) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return 'Password needs at least one letter and one number.';
  return '';
}
function makeToken(email) {
  const payload = Buffer.from(`${email}|${Date.now() + TOKEN_TTL_MS}`).toString('base64url');
  return `${payload}.${hmac(SECRET, payload)}`;
}
async function authenticate(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(SECRET, payload))) return null;
  const [email, expiry] = Buffer.from(payload, 'base64url').toString().split('|');
  if (!email || !(Number(expiry) > Date.now())) return null;
  const admin = (await loadAdmins()).find((a) => a.email === email && a.active);
  return admin ?? null; // a deactivated admin loses access immediately
}

/* ------------------------------------------------------------------ enquiry rate limiting */
const recentMobile = new Map(); // mobile -> timestamp
const floodWindow = []; // global submission timestamps
const isValidMobile = (m) => /^[6-9]\d{9}$/.test(m);
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function submitEnquiry(p) {
  if (p.website) return { ok: true }; // honeypot: pretend success, store nothing
  const name = clip(p.name, 60);
  const mobile = String(p.mobile ?? '').replace(/\D/g, '');
  const email = clip(p.email, 120);
  const exam = clip(p.exam, 40);
  const source = clip(p.source, 80) || '/';
  // Only name, mobile number and exam are mandatory. Year, email, city and message are optional.
  const year = clip(p.year, 8);
  if (name.length < 2) return { ok: false, code: 'invalid', error: 'Please enter your name.' };
  if (!isValidMobile(mobile))
    return { ok: false, code: 'invalid', error: 'Please enter a valid 10-digit mobile number.' };
  if (!EXAMS.includes(exam))
    return {
      ok: false,
      code: 'invalid',
      error: 'Please select the exam you are preparing for.',
    };
  if (email && !isValidEmail(email))
    return { ok: false, code: 'invalid', error: 'Please enter a valid email address.' };
  if (year && !/^\d{4}$/.test(year))
    return { ok: false, code: 'invalid', error: 'Please choose a valid year of attempt.' };

  const now = Date.now();
  while (floodWindow.length && now - floodWindow[0] > 60_000) floodWindow.shift();
  if (floodWindow.length >= 30)
    return { ok: false, code: 'busy', error: 'Too many requests. Please try again in a minute.' };
  if (recentMobile.has(mobile) && now - recentMobile.get(mobile) < 10 * 60_000)
    return { ok: false, code: 'duplicate', error: 'Already received.' };
  floodWindow.push(now);
  recentMobile.set(mobile, now);

  const row = {
    id: `${now.toString(36)}${randomBytes(3).toString('hex')}`,
    received: istNow(),
    name: noFormula(name),
    mobile,
    email: noFormula(email),
    exam,
    year,
    city: noFormula(clip(p.city, 60)),
    message: noFormula(clip(p.message, 300)),
    source: noFormula(source),
    utm_source: noFormula(clip(p.utm_source, 80)),
    utm_medium: noFormula(clip(p.utm_medium, 80)),
    utm_campaign: noFormula(clip(p.utm_campaign, 120)),
    status: 'Open',
    notes: '',
    last_updated: '',
    updated_by: '',
  };
  enquiries.unshift(row);
  await writeAtomic(ENQ_FILE, JSON.stringify(enquiries, null, 2));
  return { ok: true };
}

/* ------------------------------------------------------------------ content (src/content) */
const sha1 = (text) => createHash('sha1').update(text).digest('hex');
function contentFile(path) {
  if (!PATH_RE.test(String(path))) return null;
  return within(CONTENT, path);
}
function validateContent(path, data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    return 'Content must be a JSON object.';
  const bad = (o) => {
    if (o && typeof o === 'object')
      for (const k of Object.keys(o))
        if (k === '__proto__' || k === 'constructor' || k === 'prototype' || bad(o[k])) return true;
    return false;
  };
  if (bad(data)) return 'Invalid key in content.';
  if (path.startsWith('landing-pages/')) {
    const slug = path.slice('landing-pages/'.length, -5);
    if (data.slug !== slug) return 'Landing page slug must match its file name.';
  }
  return '';
}
async function readContent(path) {
  const file = contentFile(path);
  if (!file) return null;
  try {
    const text = await readFile(file, 'utf8');
    return { path, sha: sha1(text), data: JSON.parse(text) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ uploads */
function detectKind(buf) {
  if (
    buf.length > 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  if (buf.length > 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  return '';
}
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'file';

/* ------------------------------------------------------------------ Instagram live feed */
// Same behaviour as the "Instagram live feed" section of Code.gs (read that for the reasoning). The token is
// kept in the git-ignored dev-server/data/instagram.json. To try the feature without a Meta account,
// connect with the token "demo": it shows sample posts and never contacts Instagram.
const IG_FILE = join(DATA, 'instagram.json');
const DAY = 24 * 3600 * 1000;
const IG = {
  API: 'https://graph.instagram.com',
  FIELDS: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
  FETCH_LIMIT: 12,
  FRESH_MS: 15 * 60 * 1000,
  RETRY_MS: 2 * 60 * 1000,
  TOKEN_LIFE_MS: 60 * DAY,
  RENEW_AFTER_MS: 10 * DAY,
  RENEW_RETRY_MS: 12 * 3600 * 1000,
  MIN_COUNT: 3,
  MAX_COUNT: 12,
  DEFAULT_HEADING: 'Latest from our Instagram',
};
let ig = await readJson(IG_FILE, {});
const saveIg = () => writeAtomic(IG_FILE, JSON.stringify(ig, null, 2));
const igCache = { posts: null, freshUntil: 0, backoffUntil: 0 };
const isDemo = () => String(ig.token || '').toLowerCase() === 'demo';

const DEMO_MEDIA = [
  [
    'p',
    'DemoPost001',
    'Congratulations to our UPSC toppers! Hard work, discipline and the right guidance.',
  ],
  ['reel', 'DemoReel001', 'Watch: how Aman planned his last 90 days before Prelims.'],
  [
    'p',
    'DemoPost002',
    'Free counselling session this Saturday at our Sector 34 centre. Walk in and ask anything.',
  ],
  ['p', 'DemoPost003', 'Punjab PCS answer-writing workshop, notes inside.'],
  ['reel', 'DemoReel002', 'Three mistakes to avoid in current affairs revision.'],
  ['p', 'DemoPost004', 'Our Patwari batch results are in. Proud of every one of you.'],
  ['p', 'DemoPost005', 'Weekly test series starts Monday. Link in bio.'],
  ['reel', 'DemoReel003', 'A day at CCS: classes, doubt sessions and silent study hall.'],
].map(([kind, code, caption], i) => ({
  id: String(i + 1),
  media_type: kind === 'reel' ? 'VIDEO' : 'IMAGE',
  media_url: `/uploads/placeholders/reel-${(i % 6) + 1}.svg`,
  thumbnail_url: `/uploads/placeholders/reel-${(i % 6) + 1}.svg`,
  permalink: `https://www.instagram.com/${kind}/${code}/`,
  caption,
  timestamp: new Date(Date.now() - (i + 1) * 2 * DAY).toISOString().replace('Z', '+0000'),
}));

/** GET to the Instagram API: { code, body }, code 0 = could not connect. The URL (it holds the token) is never logged. */
async function igCall(path, params) {
  if (isDemo()) {
    if (path === '/me/media') return { code: 200, body: { data: DEMO_MEDIA } };
    if (path === '/refresh_access_token')
      return { code: 200, body: { access_token: 'demo', expires_in: 60 * 24 * 3600 } };
    return { code: 200, body: { username: 'ccs_demo', account_type: 'BUSINESS' } };
  }
  try {
    const res = await fetch(`${IG.API}${path}?${new URLSearchParams(params)}`, {
      signal: AbortSignal.timeout(15000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    return { code: res.status, body };
  } catch {
    console.warn('[dev-api] Instagram request failed to connect.');
    return { code: 0, body: null };
  }
}
function igError(r) {
  if (r.code === 0) return 'Could not reach Instagram. Please try again in a minute.';
  const err = r.body?.error;
  if (err && (Number(err.code) === 190 || /token/i.test(String(err.message || ''))))
    return 'Instagram no longer accepts this access token (it expired or was revoked). Generate a new token and connect again.';
  if (err?.message) return `Instagram said: ${clip(err.message, 160)}`;
  return `Instagram returned an unexpected answer (HTTP ${r.code}).`;
}
const IG_PERMALINK =
  /^https:\/\/www\.instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|p|tv)\/([A-Za-z0-9_-]{5,20})\/?(?:[?#].*)?$/;
const IG_CDN = /^https:\/\/[a-z0-9.-]+\.(cdninstagram\.com|fbcdn\.net)\//i;
/** Only what the Home page needs, and only values it can safely use; anything unexpected drops the post. */
function igCleanPosts(data) {
  const posts = [];
  for (const m of Array.isArray(data) ? data : []) {
    if (!m || typeof m !== 'object') continue;
    const ref = String(m.permalink || '').match(IG_PERMALINK);
    const video = m.media_type === 'VIDEO';
    const image = String(video ? (m.thumbnail_url ?? '') : (m.media_url ?? ''));
    const okImage =
      image.length <= 1000 &&
      (IG_CDN.test(image) ||
        (isDemo() && /^\/uploads\/placeholders\/[a-z0-9-]+\.svg$/.test(image)));
    if (!ref || !okImage) continue;
    posts.push({
      kind: ref[1],
      code: ref[2],
      video,
      image,
      caption: clip(m.caption, 140),
      ts: clip(m.timestamp, 30),
    });
  }
  return posts;
}
async function igRenew() {
  if (!ig.token) return { ok: false, error: 'Instagram is not connected.' };
  const r = await igCall('/refresh_access_token', {
    grant_type: 'ig_refresh_token',
    access_token: ig.token,
  });
  if (r.code === 200 && r.body?.access_token) {
    const now = Date.now();
    ig.token = String(r.body.access_token);
    ig.refreshed = now;
    ig.expires =
      now + (Number(r.body.expires_in) > 0 ? Number(r.body.expires_in) * 1000 : IG.TOKEN_LIFE_MS);
    ig.expiresExact = true;
    await saveIg();
    return { ok: true };
  }
  return { ok: false, error: igError(r) };
}
async function igRenewIfDue() {
  const now = Date.now();
  if (
    now - (ig.refreshed || 0) < IG.RENEW_AFTER_MS ||
    now - (ig.renewTried || 0) < IG.RENEW_RETRY_MS
  )
    return;
  ig.renewTried = now;
  await igRenew();
}
/** The cleaned posts, from cache when possible: { posts, error?, stale? } */
async function igFeed(force) {
  if (!ig.token) return { posts: [], error: 'Instagram is not connected.' };
  const now = Date.now();
  if (!force && igCache.posts && now < igCache.freshUntil) return { posts: igCache.posts };
  if (!force && now < igCache.backoffUntil)
    return { posts: igCache.posts ?? [], error: ig.lastError || '', stale: Boolean(igCache.posts) };
  await igRenewIfDue();
  const r = await igCall('/me/media', {
    fields: IG.FIELDS,
    limit: IG.FETCH_LIMIT,
    access_token: ig.token,
  });
  if (r.code === 200 && Array.isArray(r.body?.data)) {
    igCache.posts = igCleanPosts(r.body.data);
    igCache.freshUntil = Date.now() + IG.FRESH_MS;
    igCache.backoffUntil = 0;
    ig.lastOk = Date.now();
    delete ig.lastError;
    await saveIg();
    return { posts: igCache.posts };
  }
  ig.lastError = igError(r);
  igCache.backoffUntil = Date.now() + IG.RETRY_MS;
  await saveIg();
  return { posts: igCache.posts ?? [], error: ig.lastError, stale: Boolean(igCache.posts) };
}
function igSettings() {
  const n = Number(ig.count);
  return {
    enabled: ig.enabled === true,
    count: n >= IG.MIN_COUNT && n <= IG.MAX_COUNT ? Math.floor(n) : 8,
    heading: ig.heading || IG.DEFAULT_HEADING,
  };
}
/** PUBLIC: nothing at all unless the admin connected and enabled the feed. */
async function instagramFeed() {
  const s = igSettings();
  if (!s.enabled || !ig.token) return { ok: true, enabled: false, posts: [] };
  const feed = await igFeed(false);
  const username = ig.username || '';
  return {
    ok: true,
    enabled: true,
    heading: s.heading,
    username,
    profile_url: username ? `https://www.instagram.com/${username}/` : '',
    posts: feed.posts.slice(0, s.count),
  };
}
/** ADMIN: everything the Instagram tab shows. The token itself is never included. */
function igStatus() {
  const s = igSettings();
  return {
    ok: true,
    connected: Boolean(ig.token),
    username: ig.username || '',
    account_type: ig.accountType || '',
    enabled: s.enabled,
    count: s.count,
    heading: s.heading,
    days_left:
      ig.token && ig.expires ? Math.max(0, Math.floor((ig.expires - Date.now()) / DAY)) : null,
    expiry_estimated: ig.expiresExact !== true,
    last_ok: ig.lastOk ? istNowOf(ig.lastOk) : '',
    last_error: ig.lastError || '',
  };
}
const istNowOf = (ms) =>
  `${new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(' ', 'T')}+05:30`;
async function getInstagram() {
  const feed = ig.token ? await igFeed(false) : { posts: [] };
  const status = igStatus();
  status.posts = feed.posts.slice(0, status.count);
  if (feed.error) status.last_error = feed.error;
  return status;
}
async function connectInstagram(p) {
  const token = String(p.access_token || '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9_.-]{20,600}$/.test(token) && token.toLowerCase() !== 'demo')
    return {
      ok: false,
      error:
        'That does not look like an Instagram access token. Copy the whole token and paste it again.',
    };
  const previous = ig.token;
  ig.token = token; // isDemo() and igCall() read it
  const r = await igCall('/me', { fields: 'user_id,username,account_type', access_token: token });
  if (!(r.code === 200 && r.body?.username)) {
    ig.token = previous;
    return { ok: false, error: igError(r) };
  }
  const now = Date.now();
  Object.assign(ig, {
    username: /^[A-Za-z0-9_.]{1,30}$/.test(String(r.body.username)) ? String(r.body.username) : '',
    accountType: clip(r.body.account_type, 30),
    refreshed: now,
    expires: now + IG.TOKEN_LIFE_MS,
    expiresExact: false,
  });
  delete ig.lastError;
  delete ig.renewTried;
  if (!previous && ig.enabled === undefined) ig.enabled = true;
  Object.assign(igCache, { posts: null, freshUntil: 0, backoffUntil: 0 });
  await saveIg();
  return getInstagram();
}
async function saveInstagramSettings(p) {
  const count = Number(p.count);
  if (!(count >= IG.MIN_COUNT && count <= IG.MAX_COUNT) || Math.floor(count) !== count)
    return { ok: false, error: `Choose between ${IG.MIN_COUNT} and ${IG.MAX_COUNT} posts.` };
  Object.assign(ig, {
    enabled: p.enabled === 'true' || p.enabled === true,
    count,
    heading: clip(p.heading, 60) || IG.DEFAULT_HEADING,
  });
  await saveIg();
  return getInstagram();
}
async function refreshInstagram() {
  if (!ig.token) return { ok: false, error: 'Instagram is not connected.' };
  const renewed = Date.now() - (ig.refreshed || 0) > DAY ? await igRenew() : null;
  const feed = await igFeed(true);
  const status = igStatus();
  status.posts = feed.posts.slice(0, status.count);
  status.last_error = feed.error || '';
  if (renewed && !renewed.ok && !feed.error) status.last_error = renewed.error;
  return status;
}
async function disconnectInstagram() {
  for (const k of [
    'token',
    'username',
    'accountType',
    'refreshed',
    'expires',
    'expiresExact',
    'renewTried',
    'lastOk',
    'lastError',
  ])
    delete ig[k];
  Object.assign(igCache, { posts: null, freshUntil: 0, backoffUntil: 0 });
  await saveIg();
  return { ok: true };
}

/* ------------------------------------------------------------------ action router */
const PUBLIC_ACTIONS = new Set(['submitEnquiry', 'login', 'instagramFeed']);

async function handle(p) {
  const action = String(p.action || '');
  if (action === 'submitEnquiry') return submitEnquiry(p);
  if (action === 'instagramFeed') return instagramFeed();

  if (action === 'login') {
    const email = clip(p.email, 120).toLowerCase();
    if (!email || !p.password) return { ok: false, error: 'Enter your login and password.' };
    if (lockedOut(email))
      return {
        ok: false,
        code: 'locked',
        error: 'Too many failed attempts. Try again in 15 minutes.',
      };
    const admin = (await loadAdmins()).find((a) => a.email === email && a.active);
    const ok = admin && safeEqual(sha256(admin.salt + String(p.password)), admin.password_hash);
    if (!ok) {
      failed.get(email).push(Date.now());
      return { ok: false, error: 'Incorrect login or password.' };
    }
    failed.delete(email);
    return {
      ok: true,
      token: makeToken(admin.email),
      name: admin.name,
      email: admin.email,
      expires_in: TOKEN_TTL_MS / 1000,
      must_change: Boolean(admin.must_change),
    };
  }

  if (PUBLIC_ACTIONS.has(action)) return { ok: false, error: 'Unknown action.' };

  // Everything below needs a valid session token.
  const me = await authenticate(p.token);
  if (!me) return { ok: false, code: 'auth', error: 'Session expired. Please log in again.' };
  // A temporary or default password may only be used to choose a new one.
  if (me.must_change && action !== 'changePassword')
    return { ok: false, code: 'must_change', error: 'Please set a new password to continue.' };

  switch (action) {
    case 'listEnquiries':
      return { ok: true, rows: enquiries.map((r) => ({ row_id: r.id, ...r, id: undefined })) };

    case 'updateEnquiry': {
      const row = enquiries.find((r) => r.id === String(p.row_id));
      if (!row) return { ok: false, error: 'Enquiry not found.' };
      if (p.status !== undefined) {
        if (!STATUSES.includes(p.status)) return { ok: false, error: 'Invalid status.' };
        row.status = p.status;
      }
      if (p.notes !== undefined) row.notes = noFormula(clip(p.notes, 1000));
      row.last_updated = istNow();
      row.updated_by = me.name;
      await writeAtomic(ENQ_FILE, JSON.stringify(enquiries, null, 2));
      return { ok: true, last_updated: row.last_updated, updated_by: row.updated_by };
    }

    case 'listContent': {
      const folder = String(p.folder || '');
      if (!CONTENT_FOLDERS.includes(folder)) return { ok: false, error: 'Unknown folder.' };
      const dir = join(CONTENT, folder);
      const names = existsSync(dir)
        ? (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()
        : [];
      const items = (await Promise.all(names.map((n) => readContent(`${folder}/${n}`)))).filter(
        Boolean,
      );
      return { ok: true, items };
    }

    case 'getContent': {
      const item = await readContent(String(p.path || ''));
      return item ? { ok: true, ...item } : { ok: false, error: 'File not found.' };
    }

    case 'saveContent': {
      const path = String(p.path || '');
      const file = contentFile(path);
      if (!file) return { ok: false, error: 'That path is not allowed.' };
      if (String(p.json || '').length > MAX_JSON_BYTES)
        return { ok: false, error: 'Content is too large.' };
      let data;
      try {
        data = JSON.parse(String(p.json));
      } catch {
        return { ok: false, error: 'Content is not valid JSON.' };
      }
      const problem = validateContent(path, data);
      if (problem) return { ok: false, error: problem };
      const current = await readContent(path);
      const sha = String(p.sha || '');
      if ((current && current.sha !== sha) || (!current && sha))
        return { ok: false, code: 'conflict', error: 'Someone else changed this item.', current };
      // THE LOCK: only the fields the admin screen shows survive; developer-only switches and
      // "set once" fields keep their stored value (see google-apps-script/content-lock.mjs).
      const cleaned = cleanContent(CONTENT_RULES, path, data, current?.data ?? null);
      if (!cleaned.ok) return { ok: false, error: cleaned.error };
      const text = JSON.stringify(cleaned.data, null, 2) + '\n';
      await writeAtomic(file, text);
      console.log(`[dev-api] ${me.name} saved ${path}`);
      return { ok: true, sha: sha1(text), local: true };
    }

    case 'deleteContent': {
      const path = String(p.path || '');
      const file = contentFile(path);
      if (!file) return { ok: false, error: 'That path is not allowed.' };
      // settings/site.json and home/home.json must always exist: without them the site cannot be built.
      if (CONTENT_RULES[path.split('/')[0]].files)
        return { ok: false, error: 'This page cannot be deleted.' };
      const current = await readContent(path);
      if (!current) return { ok: false, error: 'File not found.' };
      if (current.sha !== String(p.sha || ''))
        return { ok: false, code: 'conflict', error: 'Someone else changed this item.', current };
      await unlink(file);
      console.log(`[dev-api] ${me.name} deleted ${path}`);
      return { ok: true, local: true };
    }

    case 'uploadFile': {
      const folder = String(p.folder || '');
      if (!UPLOAD_FOLDERS.includes(folder))
        return { ok: false, error: 'Upload folder not allowed.' };
      const buf = Buffer.from(String(p.base64 || ''), 'base64');
      const kind = detectKind(buf);
      if (kind === 'webp' && buf.length > MAX_IMAGE_BYTES)
        return { ok: false, error: 'Image is too large (max 1.5 MB).' };
      if (kind === 'pdf' && buf.length > MAX_PDF_BYTES)
        return { ok: false, error: 'PDF is too large (max 5 MB).' };
      if (!kind) return { ok: false, error: 'Only WebP images and PDF files can be uploaded.' };
      if (kind === 'pdf' && folder !== 'resources')
        return { ok: false, error: 'PDFs can only be uploaded to resources.' };
      const name = `${slugify(p.filename)}-${Date.now()}.${kind}`;
      const file = within(UPLOADS, join(folder, name));
      if (!file) return { ok: false, error: 'Bad file name.' };
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, buf);
      console.log(`[dev-api] ${me.name} uploaded /uploads/${folder}/${name}`);
      return { ok: true, path: `/uploads/${folder}/${name}`, local: true };
    }

    case 'changePassword': {
      const admins = await loadAdmins();
      const a = admins.find((x) => x.email === me.email);
      if (!safeEqual(sha256(a.salt + String(p.old_password || '')), a.password_hash))
        return { ok: false, error: 'Current password is incorrect.' };
      const problem = passwordProblem(p.new_password);
      if (problem) return { ok: false, error: problem };
      if (p.new_password === p.old_password)
        return { ok: false, error: 'Choose a password different from the current one.' };
      a.salt = randomBytes(16).toString('hex');
      a.password_hash = sha256(a.salt + p.new_password);
      delete a.must_change;
      await writeAtomic(ADMINS_FILE, JSON.stringify(admins, null, 2));
      return { ok: true };
    }

    case 'listAdmins':
      return { ok: true, admins: (await loadAdmins()).map(adminPublic) };

    case 'addAdmin': {
      const email = clip(p.email, 120).toLowerCase();
      const name = clip(p.name, 60);
      if (!/^[a-z0-9._@+-]{3,120}$/.test(email))
        return { ok: false, error: 'Login must be 3-120 characters (letters, numbers, . _ - @).' };
      if (name.length < 2) return { ok: false, error: 'Enter the admin’s name.' };
      const problem = passwordProblem(p.password);
      if (problem) return { ok: false, error: problem };
      const admins = await loadAdmins();
      if (admins.some((a) => a.email === email))
        return { ok: false, error: 'An admin with this login already exists.' };
      const salt = randomBytes(16).toString('hex');
      admins.push({
        email,
        name: noFormula(name),
        salt,
        password_hash: sha256(salt + p.password),
        active: true,
        must_change: true,
      });
      await writeAtomic(ADMINS_FILE, JSON.stringify(admins, null, 2));
      return { ok: true };
    }

    case 'setAdminActive': {
      const admins = await loadAdmins();
      const a = admins.find((x) => x.email === String(p.email || '').toLowerCase());
      if (!a) return { ok: false, error: 'Admin not found.' };
      const active = p.active === 'true' || p.active === true;
      if (!active && admins.filter((x) => x.active && x.email !== a.email).length === 0)
        return { ok: false, error: 'You cannot deactivate the last active admin.' };
      a.active = active;
      await writeAtomic(ADMINS_FILE, JSON.stringify(admins, null, 2));
      return { ok: true };
    }

    case 'resetAdminPassword': {
      const admins = await loadAdmins();
      const a = admins.find((x) => x.email === String(p.email || '').toLowerCase());
      if (!a) return { ok: false, error: 'Admin not found.' };
      const problem = passwordProblem(p.password);
      if (problem) return { ok: false, error: problem };
      a.salt = randomBytes(16).toString('hex');
      a.password_hash = sha256(a.salt + p.password);
      a.must_change = true; // whoever received the temporary password must replace it
      await writeAtomic(ADMINS_FILE, JSON.stringify(admins, null, 2));
      return { ok: true };
    }

    case 'getInstagram':
      return getInstagram();
    case 'connectInstagram':
      return connectInstagram(p);
    case 'saveInstagramSettings':
      return saveInstagramSettings(p);
    case 'refreshInstagram':
      return refreshInstagram();
    case 'disconnectInstagram':
      return disconnectInstagram();

    default:
      return { ok: false, error: 'Unknown action.' };
  }
}

/* ------------------------------------------------------------------ http */
let queue = Promise.resolve(); // serialise writes: the same guarantee LockService gives in Apps Script
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }
  if (req.method === 'GET') return json(res, 200, { ok: true, service: 'ccs-dev-backend' }, origin);
  if (req.method !== 'POST')
    return json(res, 405, { ok: false, error: 'Method not allowed.' }, origin);

  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return json(res, 413, { ok: false, error: 'Request too large.' }, origin);
    chunks.push(c);
  }
  const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
  const run = queue.then(() => handle(params));
  queue = run.catch(() => {});
  try {
    json(res, 200, await run, origin);
  } catch (err) {
    console.error('[dev-api] error', err);
    json(res, 500, { ok: false, error: 'Server error.' }, origin);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[dev-api] listening on http://localhost:${PORT}  (admin login: admin.ccs.chandigar)`,
  );
});
