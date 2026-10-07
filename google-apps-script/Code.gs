/**
 * Chandigarh Civil Services (CCS): backend on Google Apps Script
 * ---------------------------------------------------------------
 * Bound to the Google Sheet "CCS Enquiries" (or, with the SHEET_ID property, opens that sheet by id).
 * Deploy as a Web app (Execute as: Me, Who has access: Anyone). See SETUP.md.
 *
 * Every request is a form-encoded POST with an `action` field; every response is JSON.
 * This file implements exactly the same API as dev-server/server.mjs (the local stand-in),
 * so the website and /admin behave identically in development and production.
 *
 * Public actions : submitEnquiry, login, instagramFeed
 * Admin actions  : listEnquiries, updateEnquiry, listContent, getContent, saveContent,
 *                  deleteContent, uploadFile, changePassword,
 *                  getInstagram, connectInstagram, saveInstagramSettings, refreshInstagram,
 *                  disconnectInstagram                     (all need a valid session token)
 *
 * WHO may sign in is FIXED in CONFIG.ADMINS below (only salted hashes of long random passwords), so nothing needs
 * to be set up in Script Properties and the website cannot add, remove or reset an admin. Each admin can choose
 * their own password with "Change my password"; that choice is kept in Script Properties (private, never in the
 * repository or the sheet).
 *
 * Secrets live ONLY in Project Settings > Script Properties (never in this file, never in the repo):
 *   GITHUB_TOKEN          fine-grained token for this repo, Contents: read/write
 *   GITHUB_REPO           "owner/ccs-website"
 *   SIGNING_SECRET        long random string used to sign admin session tokens
 *   SHEET_ID              optional: id of the enquiries sheet, when this script is NOT bound to it
 *                         (a script owned by the developer, so the institute's account never holds the secrets)
 *   IG_*                  written by the admin's Instagram tab (access token, account name, display settings).
 *                         Never set by hand and never sent back to the browser: see "Instagram live feed" below.
 */

/* ============================== CONFIG (edit here) ============================== */
var CONFIG = {
  // Optional: get an email for every new enquiry. Leave '' to disable.
  ALERT_EMAIL: '',
  GITHUB_BRANCH: 'main',
  TIMEZONE: 'Asia/Kolkata',
  TOKEN_TTL_MS: 12 * 60 * 60 * 1000,
  // WHO CAN SIGN IN IS FIXED HERE, IN CODE. There is no admin table and no way to add, remove or reset an admin from
  // the website, so nobody can change who may sign in except by changing this file.
  // Only the password's salted SHA-256 hash is stored here. This repository is public, so this starting password must
  // be long and random (16+ characters, never a word or a pattern); a hash of a short or guessable password could be
  // cracked offline. An admin can then choose their own password in the admin panel (Settings > Change my password):
  // that is stored privately in Script Properties and replaces this one, so this hash stops being their password.
  //   Add a person:                      npm run hash -- --generate   (prints a ready-to-paste entry and the password,
  //                                      shown once), add the entry here, deploy a new version.
  //   Reset a forgotten password:        replace that person's salt and hash with a new pair and deploy. A password they
  //                                      chose is ignored as soon as the hash here changes.
  //   Remove access:                     delete the person's entry and deploy. Their open sessions end at once.
  ADMINS: [
    { login: 'admin.ccs.chandigar', name: 'CCS Admin',
      salt: 'd259c7acf09e5278ddbb59020ee502fb',
      hash: '218629b410307d2c5903e1e254129f342038c3877b0523842226214f6b6c6f2f' }
  ]
};

var ENQUIRY_SHEET = 'Enquiries';
var SUMMARY_SHEET = 'Summary';
var STATUSES = ['Open', 'Contacted', 'Resolved', 'Enrolled'];
var EXAMS = ['UPSC CSE', 'Punjab PSC (PCS)', 'Punjab One Day Exams', 'Other'];
var CONTENT_FOLDERS = ['settings', 'home', 'courses', 'teachers', 'results', 'reels', 'resources', 'exam-updates', 'landing-pages', 'tests'];
var UPLOAD_FOLDERS = ['courses', 'teachers', 'results', 'reels', 'resources', 'home', 'founder', 'landing-pages', 'misc'];
var PATH_RE = new RegExp('^(' + CONTENT_FOLDERS.join('|') + ')/[a-z0-9][a-z0-9_-]{0,80}\\.json$');
var MAX_JSON_CHARS = 60 * 1024;
var MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
var MAX_PDF_BYTES = 5 * 1024 * 1024;

// Sheet "Enquiries" columns (ID is a stable key: row numbers shift because new rows go on top).
var COLS = ['Received (IST)', 'Name', 'Mobile', 'Email', 'Exam', 'Year of attempt', 'City', 'Message',
            'Source', 'UTM source', 'UTM medium', 'UTM campaign', 'Status', 'Notes', 'Last updated', 'Updated by', 'ID'];
var C = {}; // column name -> 1-based index
COLS.forEach(function (name, i) { C[name] = i + 1; });

/* ================================ HTTP entry points ================================ */
function doGet() {
  return out_({ ok: true, service: 'ccs-backend' });
}

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    return out_(route_(p));
  } catch (err) {
    console.error(err && err.stack || err);
    return out_({ ok: false, error: 'Server error. Please try again.' });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(p) {
  var action = String(p.action || '');
  if (action === 'submitEnquiry') return submitEnquiry_(p);
  if (action === 'login') return login_(p);
  if (action === 'instagramFeed') return instagramFeed_();

  var me = authenticate_(p.token);
  if (!me) return { ok: false, code: 'auth', error: 'Session expired. Please log in again.' };

  switch (action) {
    case 'listEnquiries': return listEnquiries_();
    case 'updateEnquiry': return updateEnquiry_(p, me);
    case 'listContent': return listContent_(p);
    case 'getContent': return getContent_(p);
    case 'saveContent': return saveContent_(p, me);
    case 'deleteContent': return deleteContent_(p, me);
    case 'uploadFile': return uploadFile_(p, me);
    case 'changePassword': return changePassword_(p, me);
    case 'getInstagram': return getInstagram_();
    case 'connectInstagram': return connectInstagram_(p);
    case 'saveInstagramSettings': return saveInstagramSettings_(p);
    case 'refreshInstagram': return refreshInstagram_();
    case 'disconnectInstagram': return disconnectInstagram_();
    default: return { ok: false, error: 'Unknown action.' };
  }
}

/* ============================== small utilities ============================== */
function props_() { return PropertiesService.getScriptProperties(); }
function ss_() {
  var id = props_().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
/** Trim, drop control characters (newlines would break CSV rows and email headers) and cap the length. */
function clip_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, n); }
/** Cells starting with = + - @ would be evaluated as formulas: neutralise them. */
function noFormula_(v) { return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; }

function toHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function sha256Hex_(s) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}
function hmacHex_(value) {
  var secret = props_().getProperty('SIGNING_SECRET');
  if (!secret || secret.length < 16) throw new Error('SIGNING_SECRET script property is missing or too short.');
  return toHex_(Utilities.computeHmacSha256Signature(value, secret));
}
/** Constant-time string comparison. */
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function randomHex_(bytes) {
  // Utilities.getUuid() is backed by a secure random source (Math.random is not).
  var s = '';
  while (s.length < bytes * 2) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, bytes * 2);
}
function isoIst_(d) {
  return d instanceof Date ? Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") : String(d || '');
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ================================== enquiries ================================== */
function submitEnquiry_(p) {
  if (p.website) return { ok: true }; // honeypot hit: pretend success, store nothing

  var name = clip_(p.name, 60);
  var mobile = String(p.mobile || '').replace(/\D/g, '');
  var email = clip_(p.email, 120);
  var exam = clip_(p.exam, 40);
  var source = clip_(p.source, 80) || '/';
  // Only name, mobile number and exam are mandatory. Year, email, city and message are optional.
  var year = clip_(p.year, 8);

  if (name.length < 2) return { ok: false, code: 'invalid', error: 'Please enter your name.' };
  if (!/^[6-9]\d{9}$/.test(mobile)) return { ok: false, code: 'invalid', error: 'Please enter a valid 10-digit mobile number.' };
  if (EXAMS.indexOf(exam) < 0) return { ok: false, code: 'invalid', error: 'Please select the exam you are preparing for.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, code: 'invalid', error: 'Please enter a valid email address.' };
  if (year && !/^\d{4}$/.test(year)) return { ok: false, code: 'invalid', error: 'Please choose a valid year of attempt.' };

  return withLock_(function () {
    var cache = CacheService.getScriptCache();
    // Global flood guard: at most 30 submissions per minute across the whole site.
    var minuteKey = 'flood:' + Math.floor(Date.now() / 60000);
    var count = Number(cache.get(minuteKey) || 0);
    if (count >= 30) return { ok: false, code: 'busy', error: 'Too many requests. Please try again in a minute.' };
    // Same mobile within 10 minutes = double-tap, not a new lead.
    if (cache.get('m:' + mobile)) return { ok: false, code: 'duplicate', error: 'Already received.' };
    cache.put(minuteKey, String(count + 1), 90);
    cache.put('m:' + mobile, '1', 600);

    var sheet = ss_().getSheetByName(ENQUIRY_SHEET);
    if (!sheet) return { ok: false, error: 'Backend is not set up yet (run setup()).' };
    var id = Date.now().toString(36) + randomHex_(3);
    var row = [
      new Date(), noFormula_(name), mobile, noFormula_(email), exam, year,
      noFormula_(clip_(p.city, 60)), noFormula_(clip_(p.message, 300)), noFormula_(source),
      noFormula_(clip_(p.utm_source, 80)), noFormula_(clip_(p.utm_medium, 80)), noFormula_(clip_(p.utm_campaign, 120)),
      'Open', '', '', '', id
    ];
    sheet.insertRowBefore(2); // newest enquiry on top
    var range = sheet.getRange(2, 1, 1, COLS.length);
    range.setValues([row]);
    range.setFontWeight('normal').setBackground(null);
    sheet.getRange(2, C['Received (IST)']).setNumberFormat('dd mmm yyyy hh:mm');
    sheet.getRange(2, C['Status']).setDataValidation(statusRule_());
    SpreadsheetApp.flush();

    if (CONFIG.ALERT_EMAIL) {
      try {
        MailApp.sendEmail(CONFIG.ALERT_EMAIL, 'New CCS enquiry: ' + name + ' (' + exam + ')',
          'Name: ' + name + '\nMobile: ' + mobile + '\nExam: ' + exam +
          (year ? '\nYear: ' + year : '') + (email ? '\nEmail: ' + email : '') +
          (clip_(p.city, 60) ? '\nCity: ' + clip_(p.city, 60) : '') + '\nSource: ' + source +
          (clip_(p.message, 300) ? '\nMessage: ' + clip_(p.message, 300) : ''));
      } catch (mailErr) { console.warn('Alert email failed: ' + mailErr); }
    }
    return { ok: true };
  });
}

function listEnquiries_() {
  var sheet = ss_().getSheetByName(ENQUIRY_SHEET);
  var last = sheet.getLastRow();
  if (last < 2) return { ok: true, rows: [] };
  var values = sheet.getRange(2, 1, last - 1, COLS.length).getValues();
  var rows = values.filter(function (r) { return r[C['ID'] - 1]; }).map(function (r) {
    return {
      row_id: String(r[C['ID'] - 1]),
      received: isoIst_(r[0]), name: r[1], mobile: String(r[2]), email: r[3], exam: r[4],
      year: String(r[5]), city: r[6], message: r[7], source: r[8], utm_source: r[9], utm_medium: r[10],
      utm_campaign: r[11], status: r[12], notes: r[13], last_updated: isoIst_(r[14]), updated_by: r[15]
    };
  });
  return { ok: true, rows: rows };
}

function updateEnquiry_(p, me) {
  return withLock_(function () {
    var sheet = ss_().getSheetByName(ENQUIRY_SHEET);
    var last = sheet.getLastRow();
    if (last < 2) return { ok: false, error: 'Enquiry not found.' };
    var cell = sheet.getRange(2, C['ID'], last - 1, 1).createTextFinder(String(p.row_id || '')).matchEntireCell(true).findNext();
    if (!cell) return { ok: false, error: 'Enquiry not found.' };
    var r = cell.getRow();
    if (p.status !== undefined) {
      if (STATUSES.indexOf(p.status) < 0) return { ok: false, error: 'Invalid status.' };
      sheet.getRange(r, C['Status']).setValue(p.status);
    }
    if (p.notes !== undefined) sheet.getRange(r, C['Notes']).setValue(noFormula_(clip_(p.notes, 1000)));
    var now = new Date();
    sheet.getRange(r, C['Last updated']).setValue(now).setNumberFormat('dd mmm yyyy hh:mm');
    sheet.getRange(r, C['Updated by']).setValue(me.name);
    return { ok: true, last_updated: isoIst_(now), updated_by: me.name };
  });
}

/** Rules for a password an admin chooses (stored privately, never in the repository). There is no lock-out, so it must be long. */
function passwordProblem_(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Password must be at least 12 characters.';
  if (pw.length > 100) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password needs at least one letter and one number.';
  if (/^(.)\1+$/.test(pw)) return 'Choose a password that is not one character repeated.';
  return '';
}

/* ================================ admins & auth ================================ */
/** The fixed admin for a login (case-insensitive), or undefined. Logins exist only in CONFIG.ADMINS. */
function findAdmin_(login) {
  var wanted = String(login || '').toLowerCase();
  return CONFIG.ADMINS.filter(function (a) { return String(a.login).toLowerCase() === wanted; })[0];
}

/** Script Properties key for the password an admin chose themselves. */
function pwKey_(login) { return 'ADMINPW_' + sha256Hex_(String(login).toLowerCase()).slice(0, 16); }

/**
 * The salt + hash that is valid right now for a fixed admin: the password they chose (private, in Script
 * Properties) or else the one fixed in CONFIG.ADMINS. A chosen password only counts while CONFIG.ADMINS still has the
 * hash it was chosen against, so replacing the hash in the code also resets a forgotten password.
 */
function credentialFor_(admin) {
  var raw = props_().getProperty(pwKey_(admin.login));
  if (raw) {
    try {
      var chosen = JSON.parse(raw);
      if (chosen.base === admin.hash.slice(0, 16) && /^[0-9a-f]{32}$/.test(chosen.salt) && /^[0-9a-f]{64}$/.test(chosen.hash)) return chosen;
    } catch (e) { /* a damaged value is ignored: the fixed password applies */ }
  }
  return admin;
}

/** Tag of the current password, carried in session tokens: changing the password ends every other session. */
function sessionTag_(cred) { return sha256Hex_('session:' + cred.hash).slice(0, 12); }

function makeToken_(login, cred) {
  var payload = Utilities.base64EncodeWebSafe(login + '|' + (Date.now() + CONFIG.TOKEN_TTL_MS) + '|' + sessionTag_(cred)).replace(/=+$/, '');
  return payload + '.' + hmacHex_(payload);
}

/**
 * NO LOCK-OUT: a wrong password never blocks anyone. (Google's web-app answers are sometimes slow, which makes people
 * retry, and a lock-out then shut the real admin out.) Instead, once a login has had more than THROTTLE_AFTER wrong
 * attempts in the last 15 minutes, every further wrong attempt is answered after a pause that grows to 5 seconds. That
 * keeps online guessing slow without ever refusing the right password.
 */
var THROTTLE_AFTER = 10;
function failKey_(login) { return 'fail:' + sha256Hex_(String(login).toLowerCase()); }
function noteFail_(login) {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(failKey_(login)) || 0) + 1;
  cache.put(failKey_(login), String(count), 900);
  if (count > THROTTLE_AFTER) Utilities.sleep(Math.min(5000, (count - THROTTLE_AFTER) * 500));
}

function login_(p) {
  var email = clip_(p.email, 120).toLowerCase();
  var password = String(p.password || '');
  if (!email || !password) return { ok: false, error: 'Enter your login and password.' };
  var admin = findAdmin_(email);
  var cred = admin && credentialFor_(admin);
  var ok = admin && safeEqual_(sha256Hex_(cred.salt + password), cred.hash);
  if (!ok) {
    noteFail_(email);
    return { ok: false, error: 'Incorrect login or password.' };
  }
  CacheService.getScriptCache().remove(failKey_(email));
  var login = String(admin.login).toLowerCase();
  return { ok: true, token: makeToken_(login, cred), name: admin.name, email: login, expires_in: CONFIG.TOKEN_TTL_MS / 1000 };
}

function authenticate_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!safeEqual_(parts[1], hmacHex_(parts[0]))) return null;
  var decoded;
  try {
    decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString().split('|');
  } catch (e) { return null; }
  if (decoded.length !== 3 || !(Number(decoded[1]) > Date.now())) return null;
  // An admin removed from CONFIG.ADMINS loses access at once, and so does every session that started before
  // the password was last changed.
  var admin = findAdmin_(decoded[0]);
  if (!admin || !safeEqual_(decoded[2], sessionTag_(credentialFor_(admin)))) return null;
  return admin;
}

function changePassword_(p, me) {
  return withLock_(function () {
    var cred = credentialFor_(me);
    var old = String(p.old_password || '');
    if (!safeEqual_(sha256Hex_(cred.salt + old), cred.hash)) {
      noteFail_(me.login);
      return { ok: false, error: 'Current password is incorrect.' };
    }
    var next = String(p.new_password || '');
    var problem = passwordProblem_(next);
    if (problem) return { ok: false, error: problem };
    if (next === old) return { ok: false, error: 'Choose a password different from the current one.' };
    if (next.toLowerCase().indexOf(String(me.login).toLowerCase()) >= 0) return { ok: false, error: 'The password must not contain your login.' };
    var salt = randomHex_(16);
    var chosen = { base: me.hash.slice(0, 16), salt: salt, hash: sha256Hex_(salt + next) };
    props_().setProperty(pwKey_(me.login), JSON.stringify(chosen));
    // This session carries on with a fresh token; every other session now has the wrong tag and ends.
    return { ok: true, token: makeToken_(String(me.login).toLowerCase(), chosen), expires_in: CONFIG.TOKEN_TTL_MS / 1000 };
  });
}

/* ============================ content via GitHub API ============================ */
function ghFetchParams_(method, payload) {
  var token = props_().getProperty('GITHUB_TOKEN');
  var params = {
    method: method,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ccs-admin' },
    muteHttpExceptions: true
  };
  if (payload) { params.contentType = 'application/json'; params.payload = JSON.stringify(payload); }
  return params;
}
function ghUrl_(path, ref) {
  var repo = props_().getProperty('GITHUB_REPO');
  if (!repo || !props_().getProperty('GITHUB_TOKEN')) throw new Error('GITHUB_REPO / GITHUB_TOKEN script properties are missing.');
  return 'https://api.github.com/repos/' + repo + '/contents/' + path + (ref ? '?ref=' + CONFIG.GITHUB_BRANCH : '');
}
function decodeB64_(b64) {
  return Utilities.newBlob(Utilities.base64Decode(String(b64).replace(/\s/g, ''))).getDataAsString('UTF-8');
}
function parseItem_(path, res) {
  if (res.getResponseCode() !== 200) return null;
  var body = JSON.parse(res.getContentText());
  return { path: path, sha: body.sha, data: JSON.parse(decodeB64_(body.content)) };
}
function contentPathOk_(path) { return PATH_RE.test(String(path || '')) && String(path).indexOf('..') < 0; }

function getContent_(p) {
  var path = String(p.path || '');
  if (!contentPathOk_(path)) return { ok: false, error: 'That path is not allowed.' };
  var res = UrlFetchApp.fetch(ghUrl_('src/content/' + path, true), ghFetchParams_('get'));
  var item = parseItem_(path, res);
  return item ? { ok: true, path: item.path, sha: item.sha, data: item.data } : { ok: false, error: 'File not found.' };
}

function listContent_(p) {
  var folder = String(p.folder || '');
  if (CONTENT_FOLDERS.indexOf(folder) < 0) return { ok: false, error: 'Unknown folder.' };
  var res = UrlFetchApp.fetch(ghUrl_('src/content/' + folder, true), ghFetchParams_('get'));
  if (res.getResponseCode() === 404) return { ok: true, items: [] };
  if (res.getResponseCode() !== 200) return { ok: false, error: 'GitHub error ' + res.getResponseCode() + '.' };
  var files = JSON.parse(res.getContentText()).filter(function (f) { return f.type === 'file' && /\.json$/.test(f.name); });
  // Fetch every file in parallel so a folder of 100 results still loads in a couple of seconds.
  var requests = files.map(function (f) {
    var r = ghFetchParams_('get');
    r.url = ghUrl_('src/content/' + folder + '/' + f.name, true);
    return r;
  });
  var responses = requests.length ? UrlFetchApp.fetchAll(requests) : [];
  var items = [];
  responses.forEach(function (r, i) {
    var item = parseItem_(folder + '/' + files[i].name, r);
    if (item) items.push(item);
  });
  return { ok: true, items: items };
}

/* ===== BEGIN GENERATED: content lock (npm run rules). Do not edit by hand. ===== */
// What the admin panel may write. Source: src/admin/schemas.ts + google-apps-script/content-lock.mjs.
var CONTENT_RULES = {
  "settings": {"files":["site"],"fields":{"phone":{"label":"Phone number (shown on the site)","type":"text","required":true,"max":20},"whatsapp_number":{"label":"WhatsApp number (digits with country code)","type":"text","required":true,"max":15},"email":{"label":"Email","type":"text","required":true,"max":80},"address":{"label":"Address","type":"textarea","required":true,"max":200},"map_url":{"label":"Google Maps link","type":"url"},"youtube_url":{"label":"YouTube channel link","type":"url"},"instagram_url":{"label":"Instagram link","type":"url"},"telegram_url":{"label":"Telegram link","type":"url"},"attempt_years":{"label":"Year-of-attempt choices in the enquiry form","type":"strings","max":4,"maxItems":8,"pattern":"^\\d{4}$","patternHelp":"Each year must be four digits, for example 2027."}},"system":[],"developerOnly":{"show_free_tests":false}},
  "home": {"files":["home"],"fields":{"hero_video_url":{"label":"Video link","type":"video"},"hero_poster":{"label":"Poster image (shown before the video loads, and on phones)","type":"image"},"hero_kicker":{"label":"Welcome line (small text above the headline)","type":"text","max":60},"hero_headline":{"label":"Headline","type":"text","required":true,"max":70},"hero_subtext":{"label":"Sub-text","type":"textarea","max":200},"hero_btn1_label":{"label":"Button 1 label (opens the enquiry form)","type":"text","required":true,"max":30},"hero_btn2_label":{"label":"Button 2 label","type":"text","required":true,"max":30},"hero_btn2_link":{"label":"Button 2 link","type":"url","required":true},"hero_search_placeholder":{"label":"Search bar hint text","type":"text","max":60},"hero_search_popular":{"label":"Popular searches (up to 6)","type":"strings","max":24,"maxItems":6},"stats":{"label":"Four stat tiles (shown under the search bar)","type":"objects","maxItems":4,"sub":[{"key":"value","label":"Value","type":"text","max":10},{"key":"label","label":"Label","type":"text","max":40}]},"founder_photo":{"label":"Founder photo","type":"image"},"founder_name":{"label":"Name","type":"text","required":true,"max":50},"founder_designation":{"label":"Designation","type":"text","max":50},"founder_kicker":{"label":"Small label","type":"text","max":40},"founder_headline":{"label":"Headline","type":"text","required":true,"max":60},"founder_message":{"label":"Message","type":"textarea","max":600},"featured_course_ids":{"label":"Three courses shown on the Home page","type":"coursePick","maxItems":3},"cta_headline":{"label":"Headline","type":"text","required":true,"max":70},"cta_subtext":{"label":"Sub-text","type":"textarea","max":160},"cta_points":{"label":"Three bullet points","type":"strings","max":90,"maxItems":3}},"system":[]},
  "landing-pages": {"fields":{"slug":{"label":"Page address","type":"text","required":true,"max":60,"addOnly":true,"pattern":"^[a-z0-9]+(?:-[a-z0-9]+)*$","patternHelp":"Page address may only use lowercase letters, numbers and single hyphens."},"internal_name":{"label":"Internal name","type":"text","required":true,"max":80},"published":{"label":"Published (unchecked = removed from the live site and sitemap)","type":"checkbox"},"show_on_main_site":{"label":"Show link in the footer “Programs” column","type":"checkbox"},"seo_title":{"label":"Browser / Google title","type":"text","max":70},"seo_description":{"label":"Google description","type":"textarea","max":160},"hero_kicker":{"label":"Small label above the headline","type":"text","max":50},"hero_headline":{"label":"Headline","type":"text","required":true,"max":70},"hero_subtext":{"label":"Sub-text","type":"textarea","max":220},"hero_bullets":{"label":"Tick points (up to 3)","type":"strings","max":80,"maxItems":3},"countdown_date":{"label":"Countdown to (optional)","type":"datetime"},"default_exam":{"label":"Exam pre-selected in the form","type":"select","required":true,"options":["UPSC CSE","Punjab PSC (PCS)","Punjab One Day Exams","Other"]},"benefits":{"label":"Benefits (3 blocks)","type":"objects","maxItems":3,"sub":[{"key":"title","label":"Title","type":"text","max":40},{"key":"text","label":"One line","type":"text","max":100}]},"show_toppers":{"label":"Show the toppers strip","type":"checkbox"},"faqs":{"label":"FAQs (up to 8)","type":"objects","maxItems":8,"sub":[{"key":"q","label":"Question","type":"text","max":120},{"key":"a","label":"Answer","type":"textarea","max":400}]},"cta_headline":{"label":"Closing headline","type":"text","max":80},"cta_button_label":{"label":"Button label","type":"text","max":30}},"system":["dummy"]},
  "courses": {"fields":{"thumbnail":{"label":"Thumbnail","type":"image"},"name":{"label":"Course name","type":"text","required":true,"max":70},"price":{"label":"Price","type":"text","required":true,"max":20},"category":{"label":"Category","type":"select","required":true,"options":["UPSC CSE","Punjab PSC","Punjab One Day","Optional","Test series"],"addOnly":true}},"system":["order","published","dummy"]},
  "teachers": {"fields":{"photo":{"label":"Photo","type":"image"},"name":{"label":"Name","type":"text","required":true,"max":60},"subject":{"label":"Subject","type":"text","required":true,"max":60},"credential":{"label":"Credential","type":"text","max":70},"bio":{"label":"Short bio","type":"textarea","max":240},"intro_video_url":{"label":"Intro video link (optional)","type":"url"}},"system":["order","published","dummy"]},
  "results": {"fields":{"photo":{"label":"Photo","type":"image"},"student_name":{"label":"Student name","type":"text","required":true,"max":60},"exam":{"label":"Exam","type":"text","required":true,"max":40},"exam_year":{"label":"Year","type":"text","required":true,"max":4},"rank_label":{"label":"Rank label","type":"text","required":true,"max":20},"quote":{"label":"Quote (optional)","type":"textarea","max":200},"show_on_home":{"label":"Show on the Home page (and landing-page topper strips)","type":"checkbox"}},"system":["order","published","dummy"]},
  "reels": {"fields":{"instagram_url":{"label":"Instagram reel link","type":"url","required":true,"pattern":"^https?:\\/\\/(www\\.)?instagram\\.com\\/([A-Za-z0-9_.]+\\/)?(reels?|p|tv)\\/[A-Za-z0-9_-]{5,20}([/?#]|$)","patternFlags":"i","patternHelp":"Paste an Instagram reel link, for example https://www.instagram.com/reel/AbCdEfGh123/"},"student_name":{"label":"Student name","type":"text","required":true,"max":40},"label":{"label":"Rank and exam","type":"text","max":50},"cover":{"label":"Cover picture","type":"image"}},"system":["order","published","dummy"]},
  "resources": {"fields":{"title":{"label":"Title","type":"text","required":true,"max":70},"subtitle":{"label":"Subtitle","type":"text","max":90},"category":{"label":"Category","type":"select","required":true,"options":["Notes & PDFs","PYQs","Current Affairs","Videos","Punjab GK"]},"type":{"label":"Type","type":"select","required":true,"options":["pdf","video","link"]},"file":{"label":"Upload a PDF","type":"file"},"url":{"label":"Link","type":"url"},"show_on_home":{"label":"Show in the Home page carousel","type":"checkbox"}},"system":["order","published","dummy"]},
  "exam-updates": {"fields":{"date":{"label":"Date","type":"date","required":true},"exam_body":{"label":"Exam body","type":"select","required":true,"options":["UPSC","PPSC","PSSSB","Punjab Police","Other"]},"category":{"label":"Category","type":"select","required":true,"options":["Notification","Exam date","Admit card","Answer key","Result","Syllabus"]},"title":{"label":"Title","type":"text","required":true,"max":120},"link":{"label":"Official link","type":"url"}},"system":["published","dummy"]},
  "tests": {"fields":{"title":{"label":"Title","type":"text","required":true,"max":80},"exam":{"label":"Exam","type":"select","required":true,"options":["UPSC CSE","Punjab PSC (PCS)","Punjab One Day Exams","Other"]},"question_count":{"label":"Questions","type":"number","required":true},"duration_min":{"label":"Duration (minutes)","type":"number","required":true},"test_url":{"label":"Test link","type":"url","required":true}},"system":["published","dummy"]}
};

function cleanContent_(rules, path, data, current) {
  var parts = String(path).split('/');
  var rule = rules[parts[0]];
  var stem = String(parts[1] || '').replace(/\.json$/, '');
  if (!rule) return { ok: false, error: 'That path is not allowed.' };
  if (rule.files && rule.files.indexOf(stem) < 0) {
    return { ok: false, error: 'That page has a fixed file name and cannot be added to.' };
  }

  var CONTROL = /[\u0000-\u001f\u007f]/g;
  var CONTROL_KEEP_LINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
  var LINK = /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i;
  var UPLOAD = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9\/_.-]{0,180}$/;
  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  var DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  var ID = /^[a-z0-9][a-z0-9_-]{0,80}$/;

  var isObject = function (v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  };
  var fail = function (field, text) {
    return { error: field.label + ' ' + text };
  };

  /** Cleans one value. Returns { value } or { error }. */
  function cleanValue(field, v) {
    var type = field.type;
    var empty = v === '' || v === null || v === undefined;

    if (type === 'checkbox') {
      if (typeof v !== 'boolean') return fail(field, 'must be on or off.');
      return { value: v };
    }

    if (type === 'number') {
      if (empty) return field.required ? fail(field, 'is required.') : { value: '' };
      if (typeof v !== 'number' || !isFinite(v) || Math.abs(v) > 1e9)
        return fail(field, 'must be a number.');
      return { value: v };
    }

    if (type === 'strings') {
      if (!Array.isArray(v)) return fail(field, 'must be a list.');
      if (v.length > (field.maxItems || 20)) return fail(field, 'has too many items.');
      var list = [];
      for (var i = 0; i < v.length; i++) {
        var one = cleanText(
          {
            label: field.label,
            type: 'text',
            max: field.max,
            pattern: field.pattern,
            patternFlags: field.patternFlags,
            patternHelp: field.patternHelp,
          },
          v[i],
        );
        if (one.error) return one;
        list.push(one.value);
      }
      return { value: list };
    }

    if (type === 'objects') {
      if (!Array.isArray(v)) return fail(field, 'must be a list.');
      if (v.length > (field.maxItems || 20)) return fail(field, 'has too many items.');
      var rows = [];
      for (var r = 0; r < v.length; r++) {
        if (!isObject(v[r])) return fail(field, 'has an invalid item.');
        var row = {};
        for (var s = 0; s < field.sub.length; s++) {
          var sub = field.sub[s];
          var cell = cleanText(sub, v[r][sub.key] === undefined ? '' : v[r][sub.key]);
          if (cell.error) return cell;
          row[sub.key] = cell.value;
        }
        rows.push(row);
      }
      return { value: rows };
    }

    if (type === 'coursePick') {
      if (!Array.isArray(v)) return fail(field, 'must be a list.');
      if (v.length > (field.maxItems || 3)) return fail(field, 'has too many items.');
      for (var c = 0; c < v.length; c++) {
        if (typeof v[c] !== 'string' || !ID.test(v[c]))
          return fail(field, 'has an invalid course.');
      }
      return { value: v.slice() };
    }

    return cleanText(field, v);
  }

  /** Text-like fields: text, textarea, select, url, video, image, file, date, datetime. */
  function cleanText(field, v) {
    if (typeof v !== 'string') return fail(field, 'must be text.');
    var type = field.type;
    var text = type === 'textarea' ? v.replace(CONTROL_KEEP_LINES, '') : v.replace(CONTROL, ' ');
    var max = field.max || (type === 'textarea' ? 1000 : 200);
    if (type === 'url' || type === 'video' || type === 'image' || type === 'file') max = 500;
    if (text.length > max) return fail(field, 'is too long (at most ' + max + ' characters).');
    if (field.required && text.replace(/^\s+|\s+$/g, '') === '') return fail(field, 'is required.');
    if (text === '') return { value: '' };

    if (type === 'select' && field.options.indexOf(text) < 0)
      return fail(field, 'has an option that is not allowed.');
    if ((type === 'url' || type === 'video') && !LINK.test(text.replace(/^\s+/, ''))) {
      return fail(field, 'must start with https:// (or / for a page on this site).');
    }
    if ((type === 'image' || type === 'file') && (!UPLOAD.test(text) || text.indexOf('..') >= 0)) {
      return fail(field, 'must be an uploaded file.');
    }
    if (type === 'file' && !/\.pdf$/i.test(text)) return fail(field, 'must be a PDF.');
    if (type === 'date' && !DATE.test(text)) return fail(field, 'is not a valid date.');
    if (type === 'datetime' && !DATETIME.test(text))
      return fail(field, 'is not a valid date and time.');
    if (field.pattern && !new RegExp(field.pattern, field.patternFlags || '').test(text)) {
      return { error: field.patternHelp || field.label + ' is not in the expected format.' };
    }
    return { value: text };
  }

  var out = {};

  // Declared content fields.
  var names = Object.keys(rule.fields);
  for (var n = 0; n < names.length; n++) {
    var key = names[n];
    var field = rule.fields[key];
    var has =
      Object.prototype.hasOwnProperty.call(data, key) &&
      data[key] !== undefined &&
      data[key] !== null;
    if (!has) {
      if (field.required) return { ok: false, error: field.label + ' is required.' };
      continue;
    }
    var cleaned = cleanValue(field, data[key]);
    if (cleaned.error) return { ok: false, error: cleaned.error };
    out[key] = cleaned.value;
  }

  // Bookkeeping keys the admin panel keeps on every item (order, published, sample marker).
  var system = rule.system || [];
  for (var k = 0; k < system.length; k++) {
    var sys = system[k];
    if (!Object.prototype.hasOwnProperty.call(data, sys)) continue;
    var value = data[sys];
    if (sys === 'order') {
      if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 100000) {
        return { ok: false, error: 'Order must be a number.' };
      }
    } else if (typeof value !== 'boolean') {
      return { ok: false, error: 'Invalid value for ' + sys + '.' };
    }
    out[sys] = value;
  }

  // Developer-only switches: never taken from the request.
  var locked = rule.developerOnly || {};
  var lockedKeys = Object.keys(locked);
  for (var d = 0; d < lockedKeys.length; d++) {
    var dk = lockedKeys[d];
    out[dk] =
      current && Object.prototype.hasOwnProperty.call(current, dk) ? current[dk] : locked[dk];
  }

  // Choices that can only be made when an item is created keep their stored value afterwards.
  if (current) {
    for (var n2 = 0; n2 < names.length; n2++) {
      var fk = names[n2];
      if (rule.fields[fk].addOnly && Object.prototype.hasOwnProperty.call(current, fk))
        out[fk] = current[fk];
    }
  }

  return { ok: true, data: out };
}
/* ===== END GENERATED ===== */

function validateContent_(path, data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return 'Content must be a JSON object.';
  var bad = function (o) {
    if (o && typeof o === 'object') {
      for (var k in o) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype' || bad(o[k])) return true;
      }
    }
    return false;
  };
  if (bad(data)) return 'Invalid key in content.';
  if (path.indexOf('landing-pages/') === 0 && data.slug !== path.slice('landing-pages/'.length, -5)) return 'Landing page slug must match its file name.';
  return '';
}

/** True when the rule has developer-only switches or set-once fields, so the stored copy must be read first. */
function needsStoredCopy_(rule) {
  if (rule.developerOnly && Object.keys(rule.developerOnly).length) return true;
  return Object.keys(rule.fields).some(function (k) { return rule.fields[k].addOnly; });
}

function saveContent_(p, me) {
  var path = String(p.path || '');
  if (!contentPathOk_(path)) return { ok: false, error: 'That path is not allowed.' };
  var jsonText = String(p.json || '');
  if (jsonText.length > MAX_JSON_CHARS) return { ok: false, error: 'Content is too large.' };
  var data;
  try { data = JSON.parse(jsonText); } catch (e) { return { ok: false, error: 'Content is not valid JSON.' }; }
  var problem = validateContent_(path, data);
  if (problem) return { ok: false, error: problem };

  // THE LOCK: keep only the fields the admin screen shows, check every value, and take developer-only
  // switches and "set once" fields from the stored copy, never from the request.
  var rule = CONTENT_RULES[path.split('/')[0]];
  var current = null;
  if (p.sha && needsStoredCopy_(rule)) {
    var read = UrlFetchApp.fetch(ghUrl_('src/content/' + path, true), ghFetchParams_('get'));
    if (read.getResponseCode() === 200) current = parseItem_(path, read).data;
    else if (read.getResponseCode() !== 404) return { ok: false, error: 'Could not read the current version from GitHub (error ' + read.getResponseCode() + '). Please try again.' };
  }
  var cleaned = cleanContent_(CONTENT_RULES, path, data, current);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };
  data = cleaned.data;

  var body = {
    message: 'admin: ' + me.name + ' updated ' + path,
    content: Utilities.base64Encode(JSON.stringify(data, null, 2) + '\n', Utilities.Charset.UTF_8),
    branch: CONFIG.GITHUB_BRANCH
  };
  if (p.sha) body.sha = String(p.sha);
  var res = UrlFetchApp.fetch(ghUrl_('src/content/' + path), ghFetchParams_('put', body));
  var code = res.getResponseCode();
  if (code === 200 || code === 201) return { ok: true, sha: JSON.parse(res.getContentText()).content.sha };
  if (code === 409 || code === 422) {
    // The file changed since this admin loaded it (or already exists): hand back the latest version.
    var cur = parseItem_(path, UrlFetchApp.fetch(ghUrl_('src/content/' + path, true), ghFetchParams_('get')));
    return { ok: false, code: 'conflict', error: 'Someone else changed this item.', current: cur };
  }
  console.error('GitHub save failed: ' + code + ' ' + res.getContentText());
  return { ok: false, error: 'Could not save to GitHub (error ' + code + ').' };
}

function deleteContent_(p, me) {
  var path = String(p.path || '');
  if (!contentPathOk_(path)) return { ok: false, error: 'That path is not allowed.' };
  // settings/site.json and home/home.json must always exist: without them the site cannot be built.
  if (CONTENT_RULES[path.split('/')[0]].files) return { ok: false, error: 'This page cannot be deleted.' };
  var res = UrlFetchApp.fetch(ghUrl_('src/content/' + path), ghFetchParams_('delete', {
    message: 'admin: ' + me.name + ' deleted ' + path, sha: String(p.sha || ''), branch: CONFIG.GITHUB_BRANCH
  }));
  var code = res.getResponseCode();
  if (code === 200) return { ok: true };
  if (code === 409 || code === 422) return { ok: false, code: 'conflict', error: 'Someone else changed this item.' };
  return { ok: false, error: 'Could not delete (error ' + code + ').' };
}

/** Accepts WebP images (compressed by the browser) and PDFs only. Detected from the file's own bytes. */
function uploadFile_(p, me) {
  var folder = String(p.folder || '');
  if (UPLOAD_FOLDERS.indexOf(folder) < 0) return { ok: false, error: 'Upload folder not allowed.' };
  var b64 = String(p.base64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { return { ok: false, error: 'Invalid file data.' }; }
  var at = function (i) { return String.fromCharCode(bytes[i] & 0xff); };
  var isWebp = bytes.length > 12 && at(0) + at(1) + at(2) + at(3) === 'RIFF' && at(8) + at(9) + at(10) + at(11) === 'WEBP';
  var isPdf = bytes.length > 5 && at(0) + at(1) + at(2) + at(3) + at(4) === '%PDF-';
  if (!isWebp && !isPdf) return { ok: false, error: 'Only WebP images and PDF files can be uploaded.' };
  if (isWebp && bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'Image is too large (max 1.5 MB).' };
  if (isPdf && bytes.length > MAX_PDF_BYTES) return { ok: false, error: 'PDF is too large (max 5 MB).' };
  if (isPdf && folder !== 'resources') return { ok: false, error: 'PDFs can only be uploaded to resources.' };

  var slug = String(p.filename || 'file').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
  var name = slug + '-' + Date.now() + (isPdf ? '.pdf' : '.webp');
  var path = 'public/uploads/' + folder + '/' + name;
  var res = UrlFetchApp.fetch(ghUrl_(path), ghFetchParams_('put', {
    message: 'admin: ' + me.name + ' uploaded ' + path, content: b64, branch: CONFIG.GITHUB_BRANCH
  }));
  if (res.getResponseCode() !== 201 && res.getResponseCode() !== 200) return { ok: false, error: 'Could not upload to GitHub (error ' + res.getResponseCode() + ').' };
  return { ok: true, path: '/uploads/' + folder + '/' + name };
}

/* ============================== Instagram live feed ============================== */
// The Home page can show the institute's latest Instagram posts. An admin pastes a long-lived access token
// into /admin > Instagram ("Instagram API with Instagram Login": the account must be a Business or Creator
// account). The token is kept in Script Properties ONLY: it is never returned to the browser, never written
// to the repo, and never logged. The public action instagramFeed returns just the sanitised posts, cached
// so that visitors never wait for Instagram and the quota is never an issue.
var IG = {
  API: 'https://graph.instagram.com',
  FIELDS: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
  FETCH_LIMIT: 12,                          // posts asked for from Instagram (the admin picks how many to show)
  FRESH_SECONDS: 15 * 60,                   // new posts reach the site within 15 minutes
  RETRY_SECONDS: 2 * 60,                    // after a failed fetch, wait before asking again
  STALE_SECONDS: 6 * 60 * 60,               // last good copy, served if Instagram is unreachable
  TOKEN_LIFE_MS: 60 * 24 * 60 * 60 * 1000,  // a long-lived token lasts 60 days, and each renewal restarts that
  RENEW_AFTER_MS: 10 * 24 * 60 * 60 * 1000, // renew a token once it is 10 days old (Instagram needs it >= 1 day old)
  RENEW_RETRY_MS: 12 * 60 * 60 * 1000,
  MIN_COUNT: 3,
  MAX_COUNT: 12,
  DEFAULT_HEADING: 'Latest from our Instagram'
};

/** GET to the Instagram API. Returns { code, body }; code 0 = could not connect. The URL (it holds the token) is never logged. */
function igCall_(path, params) {
  var query = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  var res;
  try {
    res = UrlFetchApp.fetch(IG.API + path + '?' + query, { method: 'get', muteHttpExceptions: true });
  } catch (e) {
    console.warn('Instagram request failed to connect.');
    return { code: 0, body: null };
  }
  var body = null;
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
  return { code: res.getResponseCode(), body: body };
}

/** A sentence the admin can act on, from an Instagram error response. */
function igError_(r) {
  if (r.code === 0) return 'Could not reach Instagram. Please try again in a minute.';
  var err = r.body && r.body.error;
  if (err && (Number(err.code) === 190 || /token/i.test(String(err.message || '')))) {
    return 'Instagram no longer accepts this access token (it expired or was revoked). Generate a new token and connect again.';
  }
  if (err && err.message) return 'Instagram said: ' + clip_(err.message, 160);
  return 'Instagram returned an unexpected answer (HTTP ' + r.code + ').';
}

/** Keeps only what the Home page needs, and only values it can safely use. Anything unexpected drops the post. */
function igCleanPosts_(data) {
  var posts = [];
  (Array.isArray(data) ? data : []).forEach(function (m) {
    if (!m || typeof m !== 'object') return;
    var ref = String(m.permalink || '').match(/^https:\/\/www\.instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|p|tv)\/([A-Za-z0-9_-]{5,20})\/?(?:[?#].*)?$/);
    var video = m.media_type === 'VIDEO';
    var image = String(video ? m.thumbnail_url || '' : m.media_url || '');
    if (!ref || image.length > 1000 || !/^https:\/\/[a-z0-9.-]+\.(cdninstagram\.com|fbcdn\.net)\//i.test(image)) return;
    posts.push({ kind: ref[1], code: ref[2], video: video, image: image, caption: clip_(m.caption, 140), ts: clip_(m.timestamp, 30) });
  });
  return posts;
}

/** Asks Instagram for a longer-lived copy of the token. Returns { ok } or { ok: false, error }. */
function igRenew_() {
  var token = props_().getProperty('IG_TOKEN');
  if (!token) return { ok: false, error: 'Instagram is not connected.' };
  var r = igCall_('/refresh_access_token', { grant_type: 'ig_refresh_token', access_token: token });
  if (r.code === 200 && r.body && r.body.access_token) {
    var now = Date.now();
    props_().setProperties({
      IG_TOKEN: String(r.body.access_token),
      IG_REFRESHED: String(now),
      IG_EXPIRES: String(now + (Number(r.body.expires_in) > 0 ? Number(r.body.expires_in) * 1000 : IG.TOKEN_LIFE_MS)),
      IG_EXPIRES_EXACT: 'true'
    });
    return { ok: true };
  }
  return { ok: false, error: igError_(r) };
}

/** Renews quietly while visitors use the site, so a connected account never needs attention. */
function igRenewIfDue_() {
  var now = Date.now();
  var refreshed = Number(props_().getProperty('IG_REFRESHED') || 0);
  var tried = Number(props_().getProperty('IG_RENEW_TRIED') || 0);
  if (now - refreshed < IG.RENEW_AFTER_MS || now - tried < IG.RENEW_RETRY_MS) return;
  props_().setProperty('IG_RENEW_TRIED', String(now));
  igRenew_();
}

/** The cleaned posts, from cache when possible. { posts, error?, stale? } */
function igFeed_(force) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('ig:posts');
  if (!props_().getProperty('IG_TOKEN')) return { posts: [], error: 'Instagram is not connected.' };
  // "fresh" is only trusted together with the copy it vouches for: the cache may drop an entry early.
  if (!force && cached && cache.get('ig:fresh')) return { posts: JSON.parse(cached) };
  if (!force && cache.get('ig:backoff')) {
    return { posts: cached ? JSON.parse(cached) : [], error: props_().getProperty('IG_LAST_ERROR') || '', stale: Boolean(cached) };
  }

  igRenewIfDue_();
  var r = igCall_('/me/media', { fields: IG.FIELDS, limit: IG.FETCH_LIMIT, access_token: props_().getProperty('IG_TOKEN') });
  if (r.code === 200 && r.body && Array.isArray(r.body.data)) {
    var posts = igCleanPosts_(r.body.data);
    cache.put('ig:posts', JSON.stringify(posts), IG.STALE_SECONDS);
    cache.put('ig:fresh', '1', IG.FRESH_SECONDS);
    cache.remove('ig:backoff');
    props_().setProperty('IG_LAST_OK', String(Date.now()));
    props_().deleteProperty('IG_LAST_ERROR');
    return { posts: posts };
  }
  var error = igError_(r);
  props_().setProperty('IG_LAST_ERROR', error);
  cache.put('ig:backoff', '1', IG.RETRY_SECONDS); // do not hammer Instagram while it is failing
  return { posts: cached ? JSON.parse(cached) : [], error: error, stale: Boolean(cached) };
}

function igSettings_() {
  var count = Number(props_().getProperty('IG_COUNT'));
  return {
    enabled: props_().getProperty('IG_ENABLED') === 'true',
    count: count >= IG.MIN_COUNT && count <= IG.MAX_COUNT ? Math.floor(count) : 8,
    heading: props_().getProperty('IG_HEADING') || IG.DEFAULT_HEADING
  };
}

/** PUBLIC. What the Home page shows: nothing at all unless the admin connected and enabled the feed. */
function instagramFeed_() {
  var s = igSettings_();
  var username = props_().getProperty('IG_USERNAME') || '';
  if (!s.enabled || !props_().getProperty('IG_TOKEN')) return { ok: true, enabled: false, posts: [] };
  var feed = igFeed_(false);
  return {
    ok: true,
    enabled: true,
    heading: s.heading,
    username: username,
    profile_url: username ? 'https://www.instagram.com/' + username + '/' : '',
    posts: feed.posts.slice(0, s.count)
  };
}

/** ADMIN. Everything the Instagram tab shows. The token itself is never included. */
function igStatus_() {
  var token = props_().getProperty('IG_TOKEN');
  var expires = Number(props_().getProperty('IG_EXPIRES') || 0);
  var lastOk = Number(props_().getProperty('IG_LAST_OK') || 0);
  var s = igSettings_();
  return {
    ok: true,
    connected: Boolean(token),
    username: props_().getProperty('IG_USERNAME') || '',
    account_type: props_().getProperty('IG_ACCOUNT_TYPE') || '',
    enabled: s.enabled,
    count: s.count,
    heading: s.heading,
    days_left: token && expires ? Math.max(0, Math.floor((expires - Date.now()) / 86400000)) : null,
    expiry_estimated: props_().getProperty('IG_EXPIRES_EXACT') !== 'true',
    last_ok: lastOk ? isoIst_(new Date(lastOk)) : '',
    last_error: props_().getProperty('IG_LAST_ERROR') || ''
  };
}

function getInstagram_() {
  var feed = props_().getProperty('IG_TOKEN') ? igFeed_(false) : { posts: [] };
  var status = igStatus_(); // read after the fetch, so "last updated" and "last problem" are current
  status.posts = feed.posts.slice(0, status.count);
  if (feed.error) status.last_error = feed.error;
  return status;
}

function connectInstagram_(p) {
  var token = String(p.access_token || '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9_.\-]{20,600}$/.test(token)) return { ok: false, error: 'That does not look like an Instagram access token. Copy the whole token and paste it again.' };
  var r = igCall_('/me', { fields: 'user_id,username,account_type', access_token: token });
  if (!(r.code === 200 && r.body && r.body.username)) return { ok: false, error: igError_(r) };
  var username = /^[A-Za-z0-9_.]{1,30}$/.test(String(r.body.username)) ? String(r.body.username) : '';
  var now = Date.now();
  var firstTime = !props_().getProperty('IG_TOKEN');
  props_().setProperties({
    IG_TOKEN: token,
    IG_USERNAME: username,
    IG_ACCOUNT_TYPE: clip_(r.body.account_type, 30),
    IG_REFRESHED: String(now),
    IG_EXPIRES: String(now + IG.TOKEN_LIFE_MS), // a token made in the Meta dashboard lasts 60 days; renewals then report the exact date
    IG_EXPIRES_EXACT: ''
  });
  props_().deleteProperty('IG_LAST_ERROR');
  props_().deleteProperty('IG_RENEW_TRIED');
  if (firstTime && props_().getProperty('IG_ENABLED') === null) props_().setProperty('IG_ENABLED', 'true');
  CacheService.getScriptCache().remove('ig:fresh');
  CacheService.getScriptCache().remove('ig:backoff');
  return getInstagram_();
}

function saveInstagramSettings_(p) {
  var count = Number(p.count);
  if (!(count >= IG.MIN_COUNT && count <= IG.MAX_COUNT) || Math.floor(count) !== count) {
    return { ok: false, error: 'Choose between ' + IG.MIN_COUNT + ' and ' + IG.MAX_COUNT + ' posts.' };
  }
  var heading = clip_(p.heading, 60) || IG.DEFAULT_HEADING;
  props_().setProperties({
    IG_ENABLED: (p.enabled === 'true' || p.enabled === true) ? 'true' : 'false',
    IG_COUNT: String(count),
    IG_HEADING: heading
  });
  return getInstagram_();
}

function refreshInstagram_() {
  if (!props_().getProperty('IG_TOKEN')) return { ok: false, error: 'Instagram is not connected.' };
  var renewed = null;
  if (Date.now() - Number(props_().getProperty('IG_REFRESHED') || 0) > 24 * 60 * 60 * 1000) renewed = igRenew_();
  var feed = igFeed_(true);
  var status = igStatus_();
  status.posts = feed.posts.slice(0, status.count);
  status.last_error = feed.error || '';
  if (renewed && !renewed.ok && !feed.error) status.last_error = renewed.error;
  return status;
}

function disconnectInstagram_() {
  ['IG_TOKEN', 'IG_USERNAME', 'IG_ACCOUNT_TYPE', 'IG_REFRESHED', 'IG_EXPIRES', 'IG_EXPIRES_EXACT',
   'IG_RENEW_TRIED', 'IG_LAST_OK', 'IG_LAST_ERROR'].forEach(function (k) { props_().deleteProperty(k); });
  var cache = CacheService.getScriptCache();
  ['ig:fresh', 'ig:backoff', 'ig:posts'].forEach(function (k) { cache.remove(k); });
  return { ok: true };
}

/* ====================================== setup ====================================== */
/** Run ONCE by hand from the editor (select setup, press Run). Safe to re-run: it never deletes data. */
function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);

  // ---- Enquiries
  var sheet = ss.getSheetByName(ENQUIRY_SHEET) || ss.insertSheet(ENQUIRY_SHEET, 0);
  sheet.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#1A1B1F').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), COLS.length).createFilter();
  sheet.getRange(2, C['Mobile'], sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.getRange(2, C['Status'], sheet.getMaxRows() - 1, 1).setDataValidation(statusRule_());
  sheet.setColumnWidths(1, COLS.length, 130);
  sheet.setColumnWidth(C['Message'], 260);
  sheet.setColumnWidth(C['Notes'], 260);
  // Colours: the rule range starts at row 1 so rows inserted at row 2 stay inside it.
  var statusRange = sheet.getRange(1, C['Status'], sheet.getMaxRows(), 1);
  var colours = { Open: ['#DCE8FF', '#0A3AB5'], Contacted: ['#FFF0C7', '#7A5200'], Resolved: ['#E6E8EC', '#3D4350'], Enrolled: ['#D7F4DB', '#0C6B1A'] };
  sheet.setConditionalFormatRules(STATUSES.map(function (s) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(colours[s][0]).setFontColor(colours[s][1]).setRanges([statusRange]).build();
  }));
  sheet.getRange(1, C['ID']).setNote('Stable unique key. Do not edit or delete: the admin panel uses it to find the right row.');

  // ---- Summary (formulas; a backup view of what /admin shows)
  var sum = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET);
  sum.clear();
  var L = function (name) { return String.fromCharCode(64 + C[name]); };
  var enq = function (name) { return ENQUIRY_SHEET + '!$' + L(name) + '$2:$' + L(name) + '$20000'; };
  sum.getRange('A1').setValue('Enquiries by status').setFontWeight('bold');
  STATUSES.forEach(function (s, i) {
    sum.getRange(2 + i, 1).setValue(s);
    sum.getRange(2 + i, 2).setFormula('=COUNTIF(' + enq('Status') + ',A' + (2 + i) + ')');
  });
  sum.getRange('A6').setValue('Total').setFontWeight('bold');
  sum.getRange('B6').setFormula('=SUM(B2:B5)').setFontWeight('bold');

  sum.getRange('A8').setValue('By exam x year of attempt').setFontWeight('bold');
  var years = ['2027', '2028', '2029'];
  var noYearCol = 2 + years.length;      // year is optional on the form, so blanks get their own column
  var totalCol = 3 + years.length;
  sum.getRange(9, 1).setValue('Exam').setFontWeight('bold');
  years.forEach(function (y, j) { sum.getRange(9, 2 + j).setNumberFormat('@').setValue(y).setFontWeight('bold'); });
  sum.getRange(9, noYearCol).setValue('No year').setFontWeight('bold');
  sum.getRange(9, totalCol).setValue('Total').setFontWeight('bold');
  EXAMS.forEach(function (ex, i) {
    var r = 10 + i;
    sum.getRange(r, 1).setValue(ex);
    years.forEach(function (y, j) {
      var colLetter = String.fromCharCode(66 + j);
      sum.getRange(r, 2 + j).setFormula('=COUNTIFS(' + enq('Exam') + ',$A' + r + ',' + enq('Year of attempt') + ',' + colLetter + '$9)');
    });
    sum.getRange(r, noYearCol).setFormula('=COUNTIFS(' + enq('Exam') + ',$A' + r + ',' + enq('Year of attempt') + ',"")');
    sum.getRange(r, totalCol).setFormula('=SUM(B' + r + ':' + String.fromCharCode(64 + noYearCol) + r + ')');
  });
  var totalRow = 10 + EXAMS.length;
  sum.getRange(totalRow, 1).setValue('Total').setFontWeight('bold');
  for (var c = 2; c <= totalCol; c++) {
    var cl = String.fromCharCode(64 + c);
    sum.getRange(totalRow, c).setFormula('=SUM(' + cl + '10:' + cl + (totalRow - 1) + ')').setFontWeight('bold');
  }

  var tr = totalRow + 2;
  sum.getRange(tr, 1).setValue('Volume').setFontWeight('bold');
  sum.getRange(tr + 1, 1).setValue('This week (since Monday)');
  sum.getRange(tr + 1, 2).setFormula('=COUNTIFS(' + enq('Received (IST)') + ',">="&(TODAY()-WEEKDAY(TODAY(),2)+1))');
  sum.getRange(tr + 2, 1).setValue('This month');
  sum.getRange(tr + 2, 2).setFormula('=COUNTIFS(' + enq('Received (IST)') + ',">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1))');
  sum.getRange(tr + 3, 1).setValue('All time');
  sum.getRange(tr + 3, 2).setFormula('=COUNTA(' + enq('ID') + ')');
  sum.setColumnWidth(1, 220);

  // Remove the default empty sheet if it is still there.
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  SpreadsheetApp.flush();
  console.log('Setup complete. Now deploy the web app (Deploy > New deployment > Web app).');
}

function statusRule_() {
  return SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
}
