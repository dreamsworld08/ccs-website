// End-to-end checks in a real browser against the BUILT site and the local dev backend.
//   terminal 1:  npm run dev:api
//   terminal 2:  npm run build:local && npm run e2e
// Covers: popup, form validation + submit, exam-update signup, landing page, filters, admin login,
// enquiry status/notes, content CRUD, image upload, security edge cases. Cleans up what it creates.
import { readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { serveDist } from './lib/static-server.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API = process.env.API_URL || 'http://localhost:8787';
const LOGIN = 'admin.ccs.chandigar';
const PASSWORD = process.env.DEV_ADMIN_PASSWORD || 'Admin@123456';
const SHOTS = process.env.SHOTS || '';

let pass = 0;
let fail = 0;
const ok = (name) => {
  pass++;
  console.log(`  ok   ${name}`);
};
const bad = (name, extra = '') => {
  fail++;
  console.log(`  FAIL ${name} ${extra}`);
};
const check = (cond, name, extra) => (cond ? ok(name) : bad(name, extra));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(action, params = {}) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action, ...params }),
  });
  return r.json();
}

try {
  const h = await fetch(API);
  if (!h.ok) throw new Error('bad status');
} catch {
  console.error(`Dev backend not reachable at ${API}. Start it with: npm run dev:api`);
  process.exit(2);
}

const { port, close } = await serveDist(join(ROOT, 'dist'));
const SITE = `http://localhost:${port}`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const login = await api('login', { email: LOGIN, password: PASSWORD });
check(login.ok, 'API login with the hardcoded admin');
let token = login.token; // refreshed after the password-change test, which ends older sessions
const enquiryRows = async () => (await api('listEnquiries', { token })).rows;

let popupMobile = '';
const mobile = (n) => `98${String(70000000 + n).padStart(8, '0')}`;
let seq = Math.floor(Date.now() / 1000) % 1000000;
const freshMobile = () => mobile(seq++);

async function newPage(width = 390, mobileEmu = true) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 844, isMobile: mobileEmu, hasTouch: mobileEmu });
  page.errors = [];
  // Each page starts without the 60-second re-submit cooldown (it is tested explicitly below).
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.removeItem('ccs_last_submit');
    } catch {
      /* ignore */
    }
  });
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_|youtube|ytimg/.test(m.text()))
      page.errors.push(m.text());
  });
  return page;
}
const open = async (page, path) => {
  await page.goto(SITE + path, { waitUntil: 'networkidle0' });
  // wait for eagerly hydrated islands (forms on landing pages etc.)
  await page.waitForFunction(
    () => document.querySelectorAll('astro-island[client="load"][ssr]').length === 0,
  );
  await sleep(250);
};
const click = async (page, sel) => {
  await page.waitForSelector(sel, { visible: true });
  await page.click(sel);
};

/* ============================================================ public site */
console.log('\nPopup + enquiry form (mobile 390px)');
{
  const page = await newPage();
  await open(page, '/');
  await page.waitForFunction(
    () => !!document.querySelector('astro-island[client="idle"]:not([ssr])') || true,
  );
  await sleep(500);
  await click(page, 'header [data-open-enquiry]');
  await page.waitForSelector('dialog[open]');
  ok('popup opens from the header Enquire button');
  const sheet = await page.evaluate(() => {
    const r = document.querySelector('dialog[open]').getBoundingClientRect();
    return {
      bottom: Math.round(r.bottom),
      vh: innerHeight,
      width: Math.round(r.width),
      vw: innerWidth,
    };
  });
  check(
    sheet.width === sheet.vw && sheet.bottom >= sheet.vh - 2,
    'popup is a full-width bottom sheet on mobile',
    JSON.stringify(sheet),
  );
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e2e-popup-390.png') });
  const focusInside = await page.evaluate(() =>
    document.querySelector('dialog[open]').contains(document.activeElement),
  );
  check(focusInside, 'focus moves into the dialog');
  await page.keyboard.press('Escape');
  await sleep(300);
  check(!(await page.$('dialog[open]')), 'Escape closes the popup');

  await click(page, 'header [data-open-enquiry]');
  await page.waitForSelector('dialog[open] form');
  await page.click('dialog[open] button[type=submit]');
  await sleep(200);
  const errCount = await page.$$eval('dialog[open] .field-error', (e) => e.length);
  // Only name, mobile number and exam are mandatory (year, email, city and message are optional).
  check(errCount === 3, 'empty submit flags the three required fields', `errors=${errCount}`);

  const num = freshMobile();
  popupMobile = num;
  await page.type('dialog[open] input[name=name]', 'E2E Popup Tester');
  await page.type('dialog[open] input[name=mobile]', '12345');
  await page.select('dialog[open] select[name=exam]', 'UPSC CSE');
  await page.select('dialog[open] select[name=year]', '2027');
  await page.click('dialog[open] button[type=submit]');
  await sleep(200);
  check(
    await page
      .$eval('dialog[open] #popup-mobile-err', (e) => /valid 10-digit/.test(e.textContent))
      .catch(() => false),
    'invalid mobile is rejected client-side',
  );
  await page.$eval('dialog[open] input[name=mobile]', (el) => {
    el.focus();
    el.select();
  });
  await page.type('dialog[open] input[name=mobile]', `+91 ${num.slice(0, 5)} ${num.slice(5)}`);
  await page.click('dialog[open] button[type=submit]');
  await page.waitForSelector('dialog[open] [role=status]', { timeout: 8000 });
  ok('valid submit shows the success state');
  const rows = await enquiryRows();
  const row = rows.find((r) => r.mobile === num);
  check(
    !!row &&
      row.status === 'Open' &&
      row.source === 'popup' &&
      row.exam === 'UPSC CSE' &&
      row.year === '2027',
    'row saved with Status=Open, source=popup',
    JSON.stringify(row),
  );
  check(page.errors.length === 0, 'no console errors on Home', page.errors.join(' | '));

  // 60-second client-side re-submit block
  await page.evaluate(() =>
    document.querySelector('dialog[open] button[aria-label="Close enquiry form"]').click(),
  );
  await sleep(300);
  await click(page, 'header [data-open-enquiry]');
  await page.waitForSelector('dialog[open] form');
  await page.type('dialog[open] input[name=name]', 'Second Try');
  await page.type('dialog[open] input[name=mobile]', freshMobile());
  await page.select('dialog[open] select[name=exam]', 'UPSC CSE');
  await page.select('dialog[open] select[name=year]', '2027');
  await page.click('dialog[open] button[type=submit]');
  await page.waitForSelector('dialog[open] [role=alert]');
  const blocked = await page.$eval('dialog[open] [role=alert]', (e) => e.textContent);
  check(
    /wait \d+ seconds/.test(blocked) && !(await enquiryRows()).some((r) => r.name === 'Second Try'),
    're-submit within 60 s is blocked in the browser',
    blocked.slice(0, 80),
  );
  await page.close();
}

console.log('\nEnquiry form: only name, mobile and exam are mandatory');
{
  const page = await newPage();
  await open(page, '/');
  await sleep(400);
  await click(page, 'header [data-open-enquiry]');
  await page.waitForSelector('dialog[open] form');
  const form = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const label = (n) => d.querySelector(`label[for="popup-${n}"]`)?.textContent ?? '';
    return {
      checkboxes: d.querySelectorAll('input[type=checkbox]').length,
      required: [...d.querySelectorAll('[required]')].map((e) => e.name).sort(),
      year: label('year'),
      email: label('email'),
      notice: /agree to be contacted/i.test(d.textContent),
      privacy: d.querySelector('a[href$="/privacy-policy/"]')?.getAttribute('rel') ?? '',
    };
  });
  check(
    form.required.join(',') === 'exam,mobile,name',
    'exactly three fields are marked required: name, mobile, exam',
    form.required.join(','),
  );
  check(
    /optional/i.test(form.year) && /optional/i.test(form.email),
    'year of attempt and email are labelled optional',
    `${form.year} | ${form.email}`,
  );
  check(
    form.checkboxes === 0 && form.notice && form.privacy.includes('noopener'),
    'no consent checkbox: a notice with a Privacy Policy link replaces it',
    JSON.stringify(form),
  );
  const num = freshMobile();
  await page.type('dialog[open] input[name=name]', 'Three Fields Only');
  await page.type('dialog[open] input[name=mobile]', num);
  await page.select('dialog[open] select[name=exam]', 'Punjab PSC (PCS)');
  await page.click('dialog[open] button[type=submit]');
  await page.waitForSelector('dialog[open] [role=status]', { timeout: 8000 });
  const row = (await enquiryRows()).find((r) => r.mobile === num);
  check(
    row?.name === 'Three Fields Only' &&
      row.exam === 'Punjab PSC (PCS)' &&
      row.year === '' &&
      row.email === '' &&
      row.city === '' &&
      row.message === '' &&
      row.status === 'Open',
    'name + mobile + exam alone is accepted and saved (year, email, city, message left blank)',
    JSON.stringify(row),
  );
  check(
    (await api('submitEnquiry', { name: 'No Exam', mobile: freshMobile(), exam: '' })).ok === false,
    'the server still refuses a missing exam',
  );
  check(
    (
      await api('submitEnquiry', {
        name: 'Bad Year',
        mobile: freshMobile(),
        exam: 'Other',
        year: 'abc',
      })
    ).ok === false,
    'a malformed year is refused, a missing one is not',
  );
  await page.close();
}

console.log('\nExam-updates signup, landing page, course-prefilled popup');
{
  const page = await newPage();
  await open(page, '/exam-updates/');
  const num = freshMobile();
  await page.waitForSelector('#eu-page-name');
  await page.type('#eu-page-name', 'E2E Signup');
  await page.type('#eu-page-mobile', num);
  await page.select('#eu-page-exam', 'Punjab One Day Exams');
  await page.click('form[aria-label="Register for regular exam updates"] button[type=submit]');
  await page.waitForSelector('[role=status]', { timeout: 8000 });
  const row = (await enquiryRows()).find((r) => r.mobile === num);
  check(
    row?.source === 'exam_updates_signup' && row?.status === 'Open' && row?.year === '',
    'signup saved with source=exam_updates_signup',
    JSON.stringify(row),
  );
  await page.close();

  const lp = await newPage();
  await open(lp, '/lp/upsc-scholarship-test-2027/');
  const preselected = await lp.$eval('#lp-exam', (s) => s.value);
  check(preselected === 'UPSC CSE', 'landing page pre-selects the exam', preselected);
  check(!(await lp.$('nav[aria-label="Main"]')), 'landing page has no main menu');
  const lpNum = freshMobile();
  await lp.type('#lp-name', 'E2E Landing');
  await lp.type('#lp-mobile', lpNum);
  await lp.select('#lp-year', '2028');
  await lp.click('#enquire button[type=submit]');
  await lp.waitForSelector('#enquire [role=status]', { timeout: 8000 }).catch(async (e) => {
    console.log(
      '  LP form state:',
      (await lp.$eval('#enquire', (n) => n.innerText)).replace(/\n+/g, ' | ').slice(0, 400),
    );
    throw e;
  });
  const lrow = (await enquiryRows()).find((r) => r.mobile === lpNum);
  check(
    lrow?.source === 'lp:upsc-scholarship-test-2027',
    'landing enquiry saved with source=lp:<slug>',
    lrow?.source,
  );
  check((await lp.$('dialog')) === null, 'no popup element on landing pages');
  await lp.close();

  // A form that has not hydrated (its script is blocked here) must not fall back to a native GET
  // submit, which would put the visitor's name and mobile number into the URL.
  const pre = await newPage(390);
  await pre.setRequestInterception(true);
  pre.on('request', (r) => (/EnquiryForm[^/]*\.js/.test(r.url()) ? r.abort() : r.continue()));
  await pre.goto(`${SITE}/lp/upsc-scholarship-test-2027/`, { waitUntil: 'load' });
  await sleep(800);
  await pre.type('#lp-name', 'Pre Hydration');
  await pre.type('#lp-mobile', '9812312312');
  await pre.click('#enquire button[type=submit]');
  await sleep(600);
  check(
    !pre.url().includes('?') && !pre.url().includes('Pre'),
    'an un-hydrated form does not put personal data in the URL',
    pre.url(),
  );
  await pre.close();

  const cp = await newPage();
  await open(cp, '/courses/');
  await sleep(400);
  await click(cp, 'article[data-category="Punjab PSC"] [data-open-enquiry]');
  await cp.waitForSelector('dialog[open] select[name=exam]');
  const ex = await cp.$eval('dialog[open] select[name=exam]', (s) => s.value);
  check(ex === 'Punjab PSC (PCS)', 'course Enquire pre-selects the exam', ex);
  await cp.close();
}

console.log('\nFilters (client-side)');
{
  const page = await newPage(1280, false);
  await open(page, '/results/');
  const shown = () => page.$$eval('[data-item]', (els) => els.filter((e) => !e.hidden).length);
  check((await shown()) === 12, 'results show 12 first', String(await shown()));
  check(
    await page.$eval('[data-more]', (b) => b.hidden),
    'Load more is hidden when everything already fits in 12',
  );
  await page.click('[data-chip-group="exam"] [data-chip="UPSC CSE"]');
  const upsc = await shown();
  check(upsc === 4, 'exam chip filters results', String(upsc));
  await page.select('[data-filter-select="year"]', '2024');
  check((await shown()) === 1, 'year dropdown narrows further');

  await open(page, '/free-resources/');
  await page.type('#resource-search', 'punjab');
  const matches = await page.$$eval('[data-item]', (els) => els.filter((e) => !e.hidden).length);
  check(matches >= 2, 'resource search matches', String(matches));
  await page.close();
}

/* ============================================================ site search */
console.log('\nSite search (nav dropdown + /search/ page)');
{
  const page = await newPage(390);
  await open(page, '/');
  await sleep(600); // let the idle-hydrated island attach
  // The Content-Security-Policy meta tag must stop a script injected into the page from running.
  await page.evaluate(() => {
    const el = document.createElement('script');
    el.textContent = 'window.__csp = 1';
    document.body.appendChild(el);
  });
  check(!(await page.evaluate(() => window.__csp)), 'CSP blocks an injected inline script');
  page.errors.length = 0; // the browser logs the expected CSP violation as a console error
  const SEARCH_BTN = 'a[aria-label^="Search free resources"]';
  const optionTexts = () =>
    page.$$eval('#nav-search-list [role=option]', (els) => els.map((e) => e.textContent.trim()));
  const typeQuery = async (text) => {
    await page.$eval('#nav-search-input', (el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type('#nav-search-input', text);
    await sleep(250);
  };

  await click(page, SEARCH_BTN);
  await page.waitForSelector('#nav-search-panel');
  // The box focuses itself a few milliseconds after the panel appears, so wait for it instead of racing it.
  const focused = await page
    .waitForFunction(() => document.activeElement?.id === 'nav-search-input', { timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  check(focused, 'search opens with the input focused');
  check(
    (await page.$$('#nav-search-panel .filter-chip')).length >= 4,
    'shows suggestions before typing',
  );

  await typeQuery('pyq');
  let opts = await optionTexts();
  check(
    opts.some((t) => /UPSC Prelims PYQ/.test(t)) &&
      opts.some((t) => /previous year papers/i.test(t)),
    'free resources found (PYQ alias also matches "previous year")',
    opts.join(' | ').slice(0, 160),
  );
  await typeQuery('hall ticket');
  opts = await optionTexts();
  check(
    opts.some((t) => /admit card/i.test(t)),
    'exam updates found through aliases ("hall ticket" -> admit card)',
    opts.join(' | ').slice(0, 160),
  );
  await typeQuery('patwari');
  opts = await optionTexts();
  check(
    opts.some((t) => /answer key/i.test(t)) && opts.some((t) => /Pooja Rani/.test(t)),
    'one word finds an exam update AND a student result',
    opts.join(' | ').slice(0, 200),
  );
  check(opts.at(-1)?.startsWith('See all'), 'last option is "See all results"');
  await typeQuery('zzzzqq');
  check(
    await page.$eval('#nav-search-panel', (el) => /No matches for/.test(el.textContent)),
    'friendly empty state',
  );

  // keyboard: ArrowDown + Enter on a result goes to the pre-filtered Results page
  await typeQuery('aman gill');
  await page.keyboard.press('ArrowDown');
  check(
    await page.$eval('#nav-search-opt-0', (el) => el.getAttribute('aria-selected') === 'true'),
    'ArrowDown highlights the first option',
  );
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.keyboard.press('Enter'),
  ]);
  check(
    /\/results\/\?q=Aman%20Gill/.test(page.url()),
    'Enter opens the result in the Results page',
    page.url(),
  );
  await page.waitForFunction(
    () => document.querySelectorAll('[data-item]:not([hidden])').length === 1,
  );
  check(
    await page.$eval('[data-q-notice]', (el) => !el.hidden && /aman gill/i.test(el.textContent)),
    'Results page shows only the searched student with a notice',
  );
  await page.click('[data-q-clear]');
  check(
    (await page.$$eval('[data-item]', (els) => els.filter((e) => !e.hidden).length)) === 12,
    '"Show all results" restores the full list',
  );

  // Enter without a highlighted option -> full search page
  await open(page, '/');
  await sleep(600);
  await click(page, SEARCH_BTN);
  await page.waitForSelector('#nav-search-input');
  await typeQuery('patwari');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.keyboard.press('Enter'),
  ]);
  check(
    /\/search\/\?q=patwari/.test(page.url()),
    'Enter without a highlighted option opens /search/?q=',
    page.url(),
  );
  await page.waitForSelector('#sr-u');
  const sections = await page.$$eval('main h2', (h) => h.map((x) => x.textContent));
  check(
    sections.includes('Exam updates') && sections.includes('Results'),
    'search page groups results by type',
    sections.join(','),
  );
  await page.click('[role=group][aria-label="Filter results by type"] button:nth-child(3)');
  await sleep(150);
  check(
    !(await page.$('#sr-r')) && !!((await page.$('#sr-u')) || (await page.$('#sr-s'))),
    'type tabs narrow the results',
  );
  check(
    await page.$eval('meta[name=robots]', (m) => /noindex/.test(m.content)),
    'search page is noindex',
  );

  // untrusted text in the query is only ever shown as text
  await page.goto(
    `${SITE}/search/?q=${encodeURIComponent('<img src=x onerror="window.__xss=1">')}`,
    { waitUntil: 'networkidle0' },
  );
  await sleep(300);
  check(
    !(await page.evaluate(() => window.__xss)) && !(await page.$('main img[src="x"]')),
    'HTML in the query is not executed or injected',
  );
  check(
    await page.$eval('[role=status]', (e) => e.textContent.includes('<img')),
    'the query is displayed as plain text',
  );

  // Escape + focus return, and "/" shortcut
  await open(page, '/courses/');
  await sleep(600);
  await click(page, SEARCH_BTN);
  await page.waitForFunction(() => document.activeElement?.id === 'nav-search-input');
  await page.keyboard.press('Escape');
  await sleep(150);
  check(
    !(await page.$('#nav-search-panel')) &&
      (await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label')?.startsWith('Search'),
      )),
    'Escape closes the panel and returns focus to the search button',
  );
  await page.keyboard.press('/');
  await page.waitForSelector('#nav-search-panel');
  ok('"/" opens search from anywhere');

  // no layout overflow with the panel open, on small phones
  for (const w of [360, 390, 430]) {
    await page.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true });
    await typeQuery('pyq');
    const o = await page.evaluate(() => {
      document.documentElement.style.overflowX = 'visible';
      document.body.style.overflowX = 'visible';
      return { s: document.documentElement.scrollWidth, v: document.documentElement.clientWidth };
    });
    check(o.s <= o.v, `search panel open: no horizontal overflow @${w}px`, JSON.stringify(o));
  }
  if (SHOTS) {
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    await page.screenshot({ path: join(SHOTS, 'e2e-search-390.png') });
  }
  check(page.errors.length === 0, 'no console errors during search', page.errors.join(' | '));
  await page.close();

  // below 360px the header icon is hidden; the mobile menu has a plain search form instead
  const small = await newPage(320);
  await open(small, '/');
  await click(small, '#nav-toggle');
  await small.type('#drawer-search', 'punjab gk');
  await Promise.all([
    small.waitForNavigation({ waitUntil: 'networkidle0' }),
    small.keyboard.press('Enter'),
  ]);
  check(
    /\/search\/\?q=punjab\+gk|\/search\/\?q=punjab%20gk/.test(small.url()),
    'menu search form works on a 320px phone',
    small.url(),
  );
  await small.waitForSelector('#sr-r');
  ok('...and lists matching free resources');
  await small.close();
}

/* ============================================================ hero search */
console.log('\nHome hero: clean 16:9 video, search bar on the bottom edge');
{
  const page = await newPage(390);
  await open(page, '/');
  await sleep(600);
  const geo = await page.evaluate(() => {
    const panel = document.querySelector('[data-hero] .panel');
    const pr = panel.getBoundingClientRect();
    const bar = document.querySelector('[data-hero] form[role=search]').getBoundingClientRect();
    const media = document.querySelector('[data-hero-media]').getBoundingClientRect();
    const h1 = document.querySelector('[data-hero] h1');
    const h1r = h1.getBoundingClientRect();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    return {
      overlapsEdge: bar.top < pr.bottom && bar.bottom > pr.bottom,
      centred: Math.abs(bar.left + bar.width / 2 - innerWidth / 2) <= 2,
      mediaFillsPanel:
        Math.abs(media.height - pr.height) <= 1 && Math.abs(media.width - pr.width) <= 1,
      ratio: pr.width / pr.height,
      // anything drawn on top of the video except the Play/Sound button
      overlayChildren: [...panel.children]
        .filter(
          (c) => c !== panel.querySelector('[data-hero-media]') && !c.matches('[data-hero-sound]'),
        )
        .filter((c) => visible(c) || getComputedStyle(c).backgroundImage !== 'none')
        .map((c) => c.tagName + '.' + String(c.className).slice(0, 40)),
      textInPanel: [...panel.querySelectorAll('h1, h2, p, a, [data-open-enquiry]')].filter(visible)
        .length,
      h1Text: h1.textContent.trim(),
      h1Hidden: h1r.width <= 2 && h1r.height <= 2,
    };
  });
  check(
    geo.mediaFillsPanel,
    'the video/poster layer fills the whole hero panel',
    JSON.stringify(geo),
  );
  check(
    Math.abs(geo.ratio - 16 / 9) < 0.03,
    'the hero is 16:9, so the whole video is visible (not cropped to a tall block)',
    String(geo.ratio),
  );
  check(
    geo.overlayChildren.length === 0 && geo.textInPanel === 0,
    'nothing is drawn over the video: no dark tint, no headline, text or buttons',
    JSON.stringify(geo.overlayChildren),
  );
  check(
    geo.h1Text.length > 3 && geo.h1Hidden,
    'the headline stays in the page as a visually hidden <h1> (search engines, screen readers)',
    JSON.stringify({ t: geo.h1Text, hidden: geo.h1Hidden }),
  );
  check(
    geo.centred && geo.overlapsEdge,
    'search bar is centred on the bottom edge of the hero',
    JSON.stringify(geo),
  );
  const play = await page.$eval('[data-hero-sound]', (b) => b.getBoundingClientRect().width > 40);
  check(play, 'the Play video button is still available on the video');
  await page.close();
}

// The hero panel must span the whole page width and stay lined up with the search bar on any window shape,
// including a wide, short desktop window (where a height cap once shrank it and left a gap on the right).
console.log('\nHome hero: full width and aligned on every screen shape');
for (const [w, h, mobile] of [
  [1410, 778, false],
  [1920, 950, false],
  [2560, 1300, false],
  [1024, 600, false],
  [768, 1024, true],
  [844, 390, true],
  [360, 640, true],
]) {
  const page = await newPage(w, mobile);
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
  await open(page, '/');
  const g = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const panel = document.querySelector('[data-hero] .panel').getBoundingClientRect();
    const bar = document.querySelector('[data-hero] form[role=search]').getBoundingClientRect();
    return {
      vw,
      left: Math.round(panel.left),
      right: Math.round(vw - panel.right),
      barOff: Math.round((bar.left + bar.right) / 2 - (panel.left + panel.right) / 2),
      cropPct: Math.max(0, Math.round((1 - panel.height / ((panel.width * 9) / 16)) * 100)),
      scrollW: document.documentElement.scrollWidth,
    };
  });
  check(
    Math.abs(g.left - g.right) <= 1 && g.left <= 10 && g.scrollW <= g.vw,
    `${w}x${h}: the hero spans the whole page width (no gap on either side)`,
    JSON.stringify(g),
  );
  check(
    Math.abs(g.barOff) <= 1,
    `${w}x${h}: the search bar is centred on the hero`,
    JSON.stringify(g),
  );
  check(g.cropPct <= 12, `${w}x${h}: at most about 11% of the video is trimmed`, JSON.stringify(g));
  await page.close();
}

{
  const page = await newPage(390);
  await open(page, '/');
  await sleep(600);
  await page.click('#hero-search-input');
  await page.waitForSelector('[data-hero] .filter-chip');
  const chips = await page.$$eval('[data-hero] .filter-chip', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check(
    chips.join('|') === 'Patwari|PYQ|Admit card|Current affairs|Punjab GK',
    'popular searches come from the admin content',
    chips.join('|'),
  );
  await page.type('#hero-search-input', 'pyq');
  await page.waitForSelector('#hero-search-list [role=option]');
  const opts = await page.$$eval('#hero-search-list [role=option]', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check(
    opts.some((t) => /UPSC Prelims PYQ/.test(t)) && opts.at(-1).startsWith('See all'),
    'typing shows live results with a "See all" row',
    opts.join(' | ').slice(0, 120),
  );
  const o = await page.evaluate(() => {
    document.documentElement.style.overflowX = 'visible';
    document.body.style.overflowX = 'visible';
    return { s: document.documentElement.scrollWidth, v: document.documentElement.clientWidth };
  });
  check(o.s <= o.v, 'no horizontal overflow with the hero results open', JSON.stringify(o));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e2e-hero-search-390.png') });
  await page.keyboard.press('Escape');
  await sleep(150);
  check(!(await page.$('#hero-search-list')), 'Escape closes the results');

  await page.$eval('#hero-search-input', (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('#hero-search-input', 'aman gill');
  await page.waitForSelector('#hero-search-opt-0');
  await page.keyboard.press('ArrowDown');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.keyboard.press('Enter'),
  ]);
  check(
    /\/results\/\?q=Aman%20Gill/.test(page.url()),
    'arrow + Enter on a student result opens it filtered',
    page.url(),
  );

  await open(page, '/');
  await sleep(600);
  await page.type('#hero-search-input', 'patwari');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('[data-hero] form[role=search] button[type=submit]'),
  ]);
  check(
    /\/search\/\?q=patwari/.test(page.url()),
    'the search button opens the full search page',
    page.url(),
  );
  check(
    page.errors.length === 0,
    'no console errors with the hero search',
    page.errors.join(' | '),
  );
  await page.close();

  for (const w of [320, 360, 430, 768, 1440]) {
    const p = await newPage(w, w < 700);
    await open(p, '/');
    await sleep(500);
    await p.click('#hero-search-input');
    await p.type('#hero-search-input', 'punjab');
    await sleep(300);
    const r = await p.evaluate(() => {
      document.documentElement.style.overflowX = 'visible';
      document.body.style.overflowX = 'visible';
      return { s: document.documentElement.scrollWidth, v: document.documentElement.clientWidth };
    });
    check(r.s <= r.v, `hero search open: no horizontal overflow @${w}px`, JSON.stringify(r));
    await p.close();
  }

  // without JavaScript the bar is still a working search form
  const nojs = await newPage(390);
  await nojs.setJavaScriptEnabled(false);
  await nojs.goto(SITE + '/', { waitUntil: 'load' });
  await nojs.type('#hero-search-input', 'pyq');
  await Promise.all([nojs.waitForNavigation({ waitUntil: 'load' }), nojs.keyboard.press('Enter')]);
  check(
    /\/search\/\?q=pyq/.test(nojs.url()),
    'with JavaScript off the hero search still opens /search/?q=',
    nojs.url(),
  );
  await nojs.close();
}

/* ============================================================ brand */
console.log('\nBrand: logo, favicon and share image');
{
  const page = await newPage(1280, false);
  await open(page, '/');
  const head = await page.evaluate(() => ({
    icons: [
      ...document.querySelectorAll(
        'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
      ),
    ].map((l) => `${l.rel}:${new URL(l.href).pathname.split('/').pop()}`),
    header: (() => {
      const img = document.querySelector('header a[aria-label$="home"] img');
      return {
        loaded: !!img && img.complete && img.naturalWidth > 0,
        text: document
          .querySelector('header a[aria-label$="home"]')
          ?.textContent.replace(/\s+/g, ' ')
          .trim(),
      };
    })(),
    footerLoaded: (() => {
      const img = document.querySelector('footer img[src*="logo-mark"]');
      return !!img && (img.loading === 'lazy' || img.complete);
    })(),
    jsonLd: (document
      .querySelector('script[type="application/ld+json"]')
      ?.textContent.match(/"logo":"([^"]+)"/) || [])[1],
  }));
  check(
    [
      'icon:favicon.ico',
      'icon:icon-192.png',
      'apple-touch-icon:apple-touch-icon.png',
      'manifest:site.webmanifest',
    ].every((x) => head.icons.includes(x)),
    'the page declares the favicon, a 192 px icon, the iPhone home-screen icon and the web manifest',
    head.icons.join(' '),
  );
  check(head.header.loaded, 'the header shows the school emblem');
  check(
    /Chandigarh\s*Civil Services/i.test(head.header.text),
    'the header shows the school name next to it',
    head.header.text,
  );
  check(head.footerLoaded, 'the footer shows the emblem');
  check(
    /\/brand\/logo-full\.png$/.test(head.jsonLd || ''),
    'search engines are pointed at the full logo (structured data)',
    String(head.jsonLd),
  );

  const get = async (path) => {
    const r = await fetch(SITE + path);
    return { ok: r.ok, bytes: Buffer.from(await r.arrayBuffer()) };
  };
  const ico = await get('/favicon.ico');
  check(
    ico.ok &&
      ico.bytes.readUInt16LE(2) === 1 &&
      ico.bytes.readUInt16LE(4) === 3 &&
      ico.bytes.length < 20000,
    'favicon.ico holds the 16, 32 and 48 px icons and is tiny',
    `${ico.bytes.length} bytes`,
  );
  const dims = async (path) => {
    const r = await get(path);
    const m = await sharp(r.bytes).metadata();
    return `${r.ok ? '' : 'MISSING '}${m.width}x${m.height}`;
  };
  check((await dims('/icon-192.png')) === '192x192', 'icon-192.png is 192 x 192');
  check((await dims('/icon-512.png')) === '512x512', 'icon-512.png is 512 x 512');
  check((await dims('/apple-touch-icon.png')) === '180x180', 'the iPhone icon is 180 x 180');
  check(
    (await dims('/og-default.png')) === '1200x630',
    'the social-share image is still 1200 x 630',
  );
  const mark = await get('/brand/logo-mark.webp');
  check(
    mark.ok && mark.bytes.length < 30000,
    'the header emblem is light (under 30 KB)',
    `${mark.bytes.length} bytes`,
  );
  const manifest = JSON.parse((await get('/site.webmanifest')).bytes.toString());
  check(
    manifest.icons?.length === 2 && manifest.name === 'Chandigarh Civil Services',
    'the web manifest names the school and lists the icons',
  );
  check(
    !(await get('/logo.svg')).ok && !(await get('/favicon.svg')).ok,
    'the old placeholder logo files are gone',
  );
  check(page.errors.length === 0, 'no console errors on Home', page.errors.join(' | '));
  await page.close();

  // No page may ask for a file that does not exist (a leftover link to a removed logo would show a broken picture).
  const missing = [];
  for (const path of [
    '/',
    '/courses/',
    '/results/',
    '/about-teachers/',
    '/free-resources/',
    '/exam-updates/',
    '/privacy-policy/',
    '/search/',
    '/lp/upsc-scholarship-test-2027/',
    '/admin/',
  ]) {
    const pg = await newPage(390);
    pg.on('response', (r) => {
      if (r.status() >= 400 && r.url().startsWith(SITE))
        missing.push(`${path} -> ${r.url().replace(SITE, '')} (${r.status()})`);
    });
    await open(pg, path);
    if (path.startsWith('/lp/')) {
      const logo = await pg.evaluate(() => {
        const img = document.querySelector('header img');
        return !!img && img.complete && img.naturalWidth > 0;
      });
      check(logo, 'the landing-page header shows the emblem too');
    }
    await pg.close();
  }
  check(
    missing.length === 0,
    'no page asks for a file that is missing (no broken logos or icons)',
    missing.join('; '),
  );

  // The header must fit on small phones: the logo may not push the menu button off the screen.
  for (const w of [360, 390]) {
    const phone = await newPage(w);
    await open(phone, '/');
    const fit = await phone.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const logo = document.querySelector('header a[aria-label$="home"]').getBoundingClientRect();
      const menu = document.querySelector('header #nav-toggle').getBoundingClientRect();
      return {
        vw,
        logoRight: Math.round(logo.right),
        menuLeft: Math.round(menu.left),
        menuRight: Math.round(menu.right),
        pageW: document.documentElement.scrollWidth,
      };
    });
    check(
      fit.menuRight <= fit.vw && fit.pageW <= fit.vw && fit.logoRight <= fit.menuLeft,
      `on a ${w} px phone the logo fits and the menu button stays on screen`,
      JSON.stringify(fit),
    );
    await phone.close();
  }
}

/* ============================================================ topper reels */
console.log('\nTopper reels (Instagram carousel)');
{
  const page = await newPage(390);
  // keep the enquiry popup's 50%-scroll auto-open out of the way of this test
  await page.evaluateOnNewDocument(() => sessionStorage.setItem('ccs_popup_shown', '1'));
  await open(page, '/');
  const pos = await page.evaluate(() => {
    const reels = document.querySelector('[data-reels-root]');
    const resources = document.querySelector('[data-carousel-root]');
    const updates = [...document.querySelectorAll('h2')]
      .find((h) => /exam update/i.test(h.textContent))
      ?.closest('section');
    const before = (a, b) =>
      !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      exists: !!reels,
      afterResources: before(resources, reels),
      beforeUpdates: before(reels, updates),
      cards: document.querySelectorAll('[data-reel]').length,
    };
  });
  check(
    pos.exists && pos.cards === 6,
    'Home shows the reel carousel with one card per published reel',
    JSON.stringify(pos),
  );
  check(
    pos.afterResources && pos.beforeUpdates,
    'it sits in the middle of the page (after Free Resources, before Exam Updates)',
  );
  const card = await page.$eval('[data-reel]', (b) => ({
    w: Math.round(b.getBoundingClientRect().width),
    h: Math.round(b.getBoundingClientRect().height),
  }));
  check(
    card.w <= 160 && Math.abs(card.h / card.w - 16 / 9) < 0.03,
    'cards are compact 9:16 tiles on phones',
    JSON.stringify(card),
  );
  check(
    (await page.$$('iframe[src*="instagram"]')).length === 0,
    'no Instagram frame is requested at page load (previews wait until the carousel is near the screen)',
  );

  await page.evaluate(() => document.querySelector('[data-reels-root]').scrollIntoView());
  await sleep(300);
  // Whatever the first card is (a real reel, a photo post or a sample), the player must open exactly that one.
  const firstCard = await page.$eval('[data-reel]', (b) => ({
    kind: b.dataset.kind,
    code: b.dataset.reel,
    name: b.dataset.name,
  }));
  const playBadges = await page.$$eval('[data-reel]', (cards) =>
    cards.map((c) => ({ kind: c.dataset.kind, play: !!c.querySelector('[data-reel-play]') })),
  );
  check(
    playBadges.every((c) => c.play === (c.kind !== 'p')),
    'reels show a play button; photo posts do not (there is nothing to play)',
    JSON.stringify(playBadges),
  );
  await page.click('[data-reel]');
  await page.waitForSelector('#reel-dialog[open] iframe');
  const d = await page.evaluate(() => {
    const dlg = document.getElementById('reel-dialog');
    const f = dlg.querySelector('iframe');
    const r = dlg.getBoundingClientRect();
    return {
      src: f.src,
      sandbox: f.getAttribute('sandbox'),
      link: dlg.querySelector('[data-reel-link]').href,
      title: document.getElementById('reel-dialog-title').textContent,
      fits: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1,
    };
  });
  check(
    d.src === `https://www.instagram.com/${firstCard.kind}/${firstCard.code}/embed/`,
    'tapping a card loads that reel in the player',
    d.src,
  );
  check(
    d.sandbox.includes('allow-scripts') && !d.sandbox.includes('allow-top-navigation'),
    'the Instagram frame is sandboxed (no top-level navigation)',
    d.sandbox,
  );
  check(
    d.link === `https://www.instagram.com/${firstCard.kind}/${firstCard.code}/` &&
      d.title === firstCard.name,
    'the player names the student and offers "Open on Instagram"',
    JSON.stringify(d),
  );
  check(d.fits, 'the player fits the phone screen');
  await page.keyboard.press('Escape');
  await sleep(250);
  check(
    !page.errors.some((e) => /Refused to (frame|load|connect)/.test(e)),
    'the Content-Security-Policy lets Instagram\'s player load (no "Refused to frame")',
    page.errors.join(' | ').slice(0, 200),
  );
  check(
    !(await page.$('#reel-dialog[open]')) && !(await page.$('#reel-dialog iframe')),
    'Escape closes the player and removes the frame (playback stops)',
  );

  // swipe row: scrolls sideways inside itself, never the page
  const sc = await page.$eval('[data-reels-track]', (t) => ({
    scrolls: t.scrollWidth > t.clientWidth,
    page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  check(
    sc.scrolls && sc.page,
    'the row swipes sideways without widening the page',
    JSON.stringify(sc),
  );

  await open(page, '/results/');
  check(
    !!(await page.$('[data-reels-root]')) && !(await page.$('.lite-video')),
    'the Results page shows the same carousel instead of a single video',
  );
  await page.close();

  // desktop arrows
  const wide = await newPage(1280, false);
  await open(wide, '/');
  const before = await wide.$eval('[data-reels-track]', (t) => t.scrollLeft);
  await wide.evaluate(() => document.querySelector('[data-reels-next]').click());
  await sleep(700);
  const after = await wide.$eval('[data-reels-track]', (t) => t.scrollLeft);
  check(after > before, 'desktop arrow scrolls the carousel', `${before} -> ${after}`);
  await wide.close();

  // admin: the Reels tab validates the link and saves a new reel
  const ADMIN_TOKEN = (await api('login', { email: LOGIN, password: PASSWORD })).token;
  const good = await api('saveContent', {
    token: ADMIN_TOKEN,
    path: 'reels/e2e-reel.json',
    json: JSON.stringify({
      instagram_url: 'https://www.instagram.com/reel/AbCdEfGh123/',
      student_name: 'E2E Reel',
      label: 'AIR 1 · TEST',
      cover: '',
      order: 99,
      published: true,
    }),
    sha: '',
  });
  check(good.ok, 'the backend accepts content in the new reels folder');
  const stored = await api('getContent', { token: ADMIN_TOKEN, path: 'reels/e2e-reel.json' });
  await api('deleteContent', { token: ADMIN_TOKEN, path: 'reels/e2e-reel.json', sha: stored.sha });
}

/* ============================================================ reel previews */
console.log('\nReel previews: the cards show the reel without a tap');
{
  // Sample reels (placeholder codes) are never previewed, and which real posts exist depends on what the
  // institute has put in the admin. So each scenario marks exactly ONE card of a given kind as real
  // before the page script runs, the way the build does for a non-sample reel, and un-marks the rest.
  const markOne = (kind) =>
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const cards = [...document.querySelectorAll('[data-reel]')];
      cards.forEach((c) => c.removeAttribute('data-preview'));
      cards.find((c) => c.dataset.kind === kind)?.setAttribute('data-preview', '');
    });
  const igFrames = (page) => page.$$eval('iframe[src*="instagram"]', (f) => f.length);
  const hasKind = async (kind) => {
    const probe = await newPage(390);
    await open(probe, '/');
    const found = await probe.$(`[data-reel][data-kind="${kind}"]`);
    await probe.close();
    return Boolean(found);
  };

  /** Loads the home page with one previewed card of this kind, and measures the preview. */
  async function previewScenario(kind) {
    const page = await newPage(390);
    await page.evaluateOnNewDocument(markOne, kind);
    await page.evaluateOnNewDocument(() => sessionStorage.setItem('ccs_popup_shown', '1'));
    await open(page, '/');
    await sleep(1500);
    check(
      (await igFrames(page)) === 0,
      'nothing is requested from Instagram while the carousel is far off screen',
    );
    await page.evaluate(() => document.querySelector('[data-reels-root]').scrollIntoView());
    await page.waitForSelector('[data-reel-preview] iframe', { timeout: 8000 });
    await sleep(400);
    const pv = await page.evaluate(() => {
      const frames = [...document.querySelectorAll('[data-reel-preview] iframe')];
      const f = frames[0];
      const card = f.closest('[data-reel]');
      const cr = card.getBoundingClientRect();
      const fr = f.getBoundingClientRect();
      return {
        count: frames.length,
        kind: card.dataset.kind,
        code: card.dataset.reel,
        src: f.src,
        sandbox: f.getAttribute('sandbox'),
        noPointer: getComputedStyle(f).pointerEvents === 'none',
        hiddenFromAt: f.getAttribute('aria-hidden') === 'true' && f.tabIndex === -1,
        inert: f.parentElement.hasAttribute('inert'),
        fillsCardWidth: Math.abs(fr.width - cr.width) <= 2,
        coversCardWidth: fr.width >= cr.width - 2,
        centredOnCard: Math.abs((fr.left + fr.right) / 2 - (cr.left + cr.right) / 2) <= 2,
        cardW: Math.round(cr.width),
      };
    });
    check(
      pv.count === 1 && pv.src === `https://www.instagram.com/${pv.kind}/${pv.code}/embed/`,
      `a real ${kind === 'p' ? 'photo post' : 'reel'} gets a preview, and only that one (placeholders are skipped)`,
      JSON.stringify(pv),
    );
    check(
      pv.noPointer && pv.hiddenFromAt && pv.inert,
      'the preview is display-only: no pointer events, not focusable, hidden from screen readers',
      JSON.stringify(pv),
    );
    if (kind === 'p') {
      // A photo post is roughly square: it is scaled to cover the tall card and cropped at the sides.
      check(
        pv.coversCardWidth && pv.centredOnCard,
        'a photo-post preview covers the card and is centred on it',
        JSON.stringify(pv),
      );
    } else {
      check(
        pv.fillsCardWidth,
        'the preview is scaled to the width of the card',
        JSON.stringify(pv),
      );
    }
    check(
      pv.sandbox?.includes('allow-scripts') && !pv.sandbox.includes('allow-top-navigation'),
      'the preview frame is sandboxed (no top-level navigation)',
      pv.sandbox,
    );
    // swiping over a card must scroll the carousel (a touch on the preview must not be swallowed)
    const sw = await page.evaluate(() => {
      const track = document.querySelector('[data-reels-track]');
      const card = document.querySelector('[data-reel][data-preview]');
      const r = card.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        hit: hit?.tagName,
        onCard: hit?.closest('[data-reel]') === card && hit?.tagName !== 'IFRAME',
        scrollable: track.scrollWidth > track.clientWidth,
      };
    });
    check(
      sw.onCard && sw.scrollable,
      'a touch on a preview lands on the card, so swiping still scrolls the carousel and a tap opens the player',
      JSON.stringify(sw),
    );
    await page.click('[data-reel][data-preview]');
    await page.waitForSelector('#reel-dialog[open] iframe');
    ok('tapping a card with a preview still opens the full player');
    await page.close();
  }

  await previewScenario('reel');
  if (await hasKind('p')) await previewScenario('p');
  else ok('(no photo post on the Home page: photo-post preview not exercised)');

  // Data-saver connections get the cover picture only.
  const lite = await newPage(390);
  await lite.evaluateOnNewDocument(markOne, 'reel');
  await lite.evaluateOnNewDocument(() => {
    sessionStorage.setItem('ccs_popup_shown', '1');
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true, effectiveType: '4g' },
    });
  });
  await open(lite, '/');
  await lite.evaluate(() => document.querySelector('[data-reels-root]').scrollIntoView());
  await sleep(2500);
  check((await igFrames(lite)) === 0, 'no previews are loaded on a data-saver connection');
  await lite.close();

  const slow = await newPage(390);
  await slow.evaluateOnNewDocument(markOne, 'reel');
  await slow.evaluateOnNewDocument(() => {
    sessionStorage.setItem('ccs_popup_shown', '1');
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: false, effectiveType: '3g' },
    });
  });
  await open(slow, '/');
  await slow.evaluate(() => document.querySelector('[data-reels-root]').scrollIntoView());
  await sleep(2500);
  check((await igFrames(slow)) === 0, 'no previews are loaded on a 2G/3G connection');
  await slow.close();
}

/* ============================================================ right-click */
console.log('\nRight-click is disabled on the public site');
{
  const page = await newPage(1280, false);
  await open(page, '/');
  const fire = (selector, type) =>
    page.evaluate(
      (sel, t) => {
        const el = document.querySelector(sel);
        const ev =
          t === 'contextmenu'
            ? new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
            : new Event(t, { bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        return ev.defaultPrevented;
      },
      selector,
      type,
    );
  check(await fire('body', 'contextmenu'), 'the context menu is blocked on the page');
  check(await fire('h1', 'contextmenu'), 'the context menu is blocked on text');
  check(await fire('footer a', 'contextmenu'), 'the context menu is blocked on links');
  check(await fire('main img, footer img', 'dragstart'), 'pictures cannot be dragged out');
  // a real right-click, as a visitor would do it
  await page.evaluate(() => {
    window.__ctx = [];
    document.addEventListener('contextmenu', (e) => window.__ctx.push(e.defaultPrevented));
  });
  await page.click('h1', { button: 'right' });
  check(
    (await page.evaluate(() => window.__ctx)).every(Boolean) &&
      (await page.evaluate(() => window.__ctx.length)) === 1,
    'a real right-click on the headline opens no menu',
  );
  // the enquiry form must stay usable: people paste their number
  await click(page, 'header [data-open-enquiry]');
  await page.waitForSelector('dialog[open] input[name=mobile]');
  check(
    (await fire('dialog[open] input[name=mobile]', 'contextmenu')) === false,
    'text fields keep their menu so a phone number can be pasted',
  );
  await page.close();

  const admin = await newPage(1280, false);
  await open(admin, '/admin/');
  check(
    (await admin.evaluate(() => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    })) === false,
    'the admin panel is not affected',
  );
  await admin.close();
}

/* ============================================================ content lock */
console.log('\nThe lock: the admin can change content, never layout or features');
{
  const readText = (p) => readFile(join(ROOT, 'src/content', p), 'utf8');
  const exists = (p) => existsSync(join(ROOT, 'src/content', p));
  const save = (path, obj, sha = '') =>
    api('saveContent', { token, path, json: JSON.stringify(obj), sha });

  // settings: the Free Tests switch belongs to the developer
  const settingsText = await readText('settings/site.json');
  const settings = JSON.parse(settingsText);
  const cur = await api('getContent', { token, path: 'settings/site.json' });
  const flipped = await save('settings/site.json', { ...settings, show_free_tests: true }, cur.sha);
  const afterFlip = JSON.parse(await readText('settings/site.json'));
  check(
    flipped.ok && afterFlip.show_free_tests === settings.show_free_tests,
    'a crafted request cannot switch Free Tests on: the stored value is kept',
    String(afterFlip.show_free_tests),
  );
  const cur2 = await api('getContent', { token, path: 'settings/site.json' });
  const extra = await save(
    'settings/site.json',
    { ...settings, layout: 'wide', custom_css: 'body{display:none}', script: '<script>1</script>' },
    cur2.sha,
  );
  const cleaned = JSON.parse(await readText('settings/site.json'));
  check(
    extra.ok && !('layout' in cleaned) && !('custom_css' in cleaned) && !('script' in cleaned),
    'fields the admin screen does not have (layout, css, scripts) are dropped, not stored',
    Object.keys(cleaned).join(','),
  );
  const cur3 = await api('getContent', { token, path: 'settings/site.json' });
  check(
    !(await save('settings/site.json', { ...settings, map_url: 'javascript:alert(1)' }, cur3.sha))
      .ok,
    'a javascript: link is refused by the server, not only by the form',
  );
  check(
    !(await save('settings/site.json', { ...settings, phone: '9'.repeat(200) }, cur3.sha)).ok,
    'over-long text is refused by the server',
  );
  await writeFile(join(ROOT, 'src/content/settings/site.json'), settingsText); // leave no trace

  // singleton pages cannot be deleted or duplicated
  const home = await api('getContent', { token, path: 'home/home.json' });
  check(
    (await api('deleteContent', { token, path: 'home/home.json', sha: home.sha })).ok === false &&
      exists('home/home.json'),
    'home/home.json cannot be deleted (the site could not be built without it)',
  );
  check(
    (await api('deleteContent', { token, path: 'settings/site.json', sha: cur3.sha })).ok ===
      false && exists('settings/site.json'),
    'settings/site.json cannot be deleted either',
  );
  check(
    (await save('settings/another.json', settings)).ok === false &&
      !exists('settings/another.json'),
    'extra copies of a single-file page cannot be created',
  );

  // set-once choices
  const course = {
    name: 'E2E Lock',
    price: '1',
    category: 'Test series',
    thumbnail: '',
    published: true,
  };
  const made = await save('courses/e2e-lock.json', course);
  const madeItem = await api('getContent', { token, path: 'courses/e2e-lock.json' });
  await save('courses/e2e-lock.json', { ...course, category: 'Optional' }, madeItem.sha);
  const kept = JSON.parse(await readText('courses/e2e-lock.json'));
  check(
    made.ok && kept.category === 'Test series',
    "a course's category cannot be changed after it is created",
    kept.category,
  );
  const fin = await api('getContent', { token, path: 'courses/e2e-lock.json' });
  await api('deleteContent', { token, path: 'courses/e2e-lock.json', sha: fin.sha });

  // the Admin screen itself shows no switch for it
  const page = await newPage(1280, false);
  await open(page, '/admin/');
  await page.type('form.login input[type=text]', LOGIN);
  await page.type('form.login input[type=password]', PASSWORD);
  await page.click('form.login button[type=submit]');
  await page.waitForSelector('.topbar');
  await page.goto(`${SITE}/admin/#settings`);
  await page.waitForSelector('fieldset.section input[type=text]');
  const labels = await page.$$eval('fieldset.section label', (l) => l.map((x) => x.textContent));
  check(
    !labels.some((t) => /free tests/i.test(t)),
    'Settings has no Free Tests switch (developer-only)',
  );
  await page.close();
}

/* ============================================================ admin */
console.log('\nAdmin panel (1280px)');
{
  const page = await newPage(1280, false);
  await open(page, '/admin/');
  await page.waitForSelector('form.login');
  await page.type('form.login input[type=text]', LOGIN);
  await page.type('form.login input[type=password]', 'wrong-password');
  await page.click('form.login button[type=submit]');
  await page.waitForSelector('.login-error');
  ok('wrong password shows an error');
  await page.$eval('form.login input[type=password]', (el) => {
    el.focus();
    el.select();
  });
  await page.type('form.login input[type=password]', PASSWORD);
  await page.click('form.login button[type=submit]');
  await page.waitForSelector('.topbar');
  ok('login works with the hardcoded credentials');
  await page.waitForSelector('table.table-enq tbody tr');
  const summary = await page.$$eval('table[aria-label="Enquiries by status"] td', (t) =>
    t.map((x) => x.textContent),
  );
  check(
    summary.length === 5 && Number(summary[4]) > 20,
    'status summary table renders',
    summary.join(','),
  );
  const tabsShown = await page.$$eval('.tabs .tab', (t) => t.map((x) => x.textContent));
  check(
    tabsShown.join('|') ===
      'Enquiries|Home Page|Courses|Results|Reels|Instagram|Teachers|Free Resources|Exam Updates|Landing Pages|Settings',
    'tabs are in the specified order, Tests hidden',
    tabsShown.join('|'),
  );
  if (SHOTS)
    await page.screenshot({ path: join(SHOTS, 'e2e-admin-enquiries.png'), fullPage: false });

  // filter + inline status
  await page.type('input[type=search]', popupMobile);
  await sleep(200);
  const rowsAfter = await page.$$('table.table-enq tbody tr');
  check(rowsAfter.length === 1, 'search filters the table', String(rowsAfter.length));
  await page.select('table.table-enq tbody tr select', 'Contacted');
  await page.waitForSelector('.tick');
  ok('status change shows the Saved tick');
  const updated = (await enquiryRows()).find((r) => r.mobile === popupMobile);
  check(
    updated.status === 'Contacted' && updated.updated_by === 'CCS Admin' && !!updated.last_updated,
    'status persisted with Updated by + Last updated',
  );
  await page.click('.notes-btn');
  await page.type('.notes-input', 'Called, wants evening batch');
  await page.click('h1'); // blur
  await sleep(600);
  const noted = (await enquiryRows()).find((r) => r.mobile === popupMobile);
  check(noted.notes === 'Called, wants evening batch', 'notes save on blur');

  // Year of attempt is optional on the form, so the Year filter needs a "Not given" choice
  await page.$eval('input[type=search]', (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const pickYear = (value) =>
    page.evaluate((v) => {
      const select = [...document.querySelectorAll('.filters select')].find((x) =>
        [...x.options].some((o) => o.textContent === 'Not given'),
      );
      select.value = v;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  await pickYear('__none__');
  await sleep(250);
  const yearCells = await page.$$eval('table.table-enq tbody tr', (rows) =>
    rows.map((r) => r.children[5].textContent.trim()),
  );
  check(
    yearCells.length > 0 && yearCells.every((y) => y === '—'),
    'the Year filter has "Not given" and shows only enquiries without a year',
    `${yearCells.length} rows`,
  );
  await pickYear('');
  await sleep(250);

  // content CRUD: add + delete a course (first remove leftovers from any earlier aborted run)
  for (const f of (await readdir(join(ROOT, 'src/content/courses'))).filter((x) =>
    x.startsWith('e2e-test-course'),
  ))
    await rm(join(ROOT, 'src/content/courses', f));
  await page.goto(`${SITE}/admin/#courses`);
  await page.waitForSelector('table.table tbody tr');
  const before = (await readdir(join(ROOT, 'src/content/courses'))).length;
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => /^Add course$/.test(b.textContent))
      .click(),
  );
  await page.waitForSelector('.drawer input#f-name');
  await page.type('#f-name', 'E2E Test Course');
  await page.type('#f-price', '₹9,999');
  await page.evaluate(() =>
    [...document.querySelectorAll('.drawer-foot button')]
      .find((b) => b.textContent === 'Save')
      .click(),
  );
  await sleep(900);
  const afterAdd = await readdir(join(ROOT, 'src/content/courses'));
  const created = afterAdd.find((f) => f.startsWith('e2e-test-course'));
  check(
    afterAdd.length === before + 1 && !!created,
    'adding a course writes a content file',
    created,
  );
  const body = JSON.parse(await readFile(join(ROOT, 'src/content/courses', created), 'utf8'));
  check(
    body.name === 'E2E Test Course' &&
      body.price === '₹9,999' &&
      body.published === true &&
      body.order > 6,
    'new course has the right fields and appended order',
    JSON.stringify(body),
  );

  // upload an image through the real admin UI (compress -> WebP -> upload)
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1800;
    c.height = 1200; // larger than 1600px so the resize path is exercised
    const x = c.getContext('2d');
    x.fillStyle = '#0042F6';
    x.fillRect(0, 0, 1800, 1200);
    x.fillStyle = '#FFB41F';
    for (let i = 0; i < 40; i++) x.fillRect(i * 40, (i * 53) % 1100, 30, 90);
    return c.toDataURL('image/png');
  });
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  const pngPath = join(ROOT, 'dist', 'e2e-test.png');
  await writeFile(pngPath, png);
  await page.waitForSelector('table.table tbody tr');
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) =>
      r.textContent.includes(name),
    );
    [...row.querySelectorAll('button')].find((b) => b.textContent === 'Edit').click();
  }, 'E2E Test Course');
  await page.waitForSelector('.drawer input[type=file]', { hidden: true });
  const fileInput = await page.$('.drawer input[type=file]');
  await fileInput.uploadFile(pngPath);
  await page.waitForFunction(() => document.querySelector('.drawer img.imgprev'), {
    timeout: 10000,
  });
  ok('image upload (compress to WebP) shows a preview');
  const preview = await page.$eval('.drawer img.imgprev', (img) => ({
    local: img.src.startsWith('data:image/webp'),
    decoded: img.complete && img.naturalWidth > 0,
  }));
  check(
    preview.local && preview.decoded,
    'the preview comes from the bytes just uploaded (a live link would 404 until the site rebuilds)',
    JSON.stringify(preview),
  );
  const toastText = await page.$$eval('.toast', (t) => t.map((x) => x.textContent).join(' | '));
  check(
    /optimised: .* → .* \(WebP, 900×600\)/.test(toastText),
    'the admin is told what the optimiser did (size before and after, format, dimensions)',
    toastText,
  );
  const uploads = (await readdir(join(ROOT, 'public/uploads/courses'))).filter((f) =>
    f.startsWith('e2e-test'),
  );
  check(
    uploads.length === 1 && uploads[0].endsWith('.webp'),
    'uploaded file stored as .webp under public/uploads/courses',
    uploads.join(','),
  );
  if (uploads[0]) {
    const stored = await sharp(join(ROOT, 'public/uploads/courses', uploads[0])).metadata();
    const bytes = (await readFile(join(ROOT, 'public/uploads/courses', uploads[0]))).length;
    check(
      stored.format === 'webp' &&
        stored.width === 900 &&
        stored.height === 600 &&
        bytes < 300 * 1024,
      "the stored picture is WebP, scaled to the field's 900 px width and under 300 KB",
      `${stored.format} ${stored.width}x${stored.height} ${bytes} bytes`,
    );
  }
  for (const f of uploads) await rm(join(ROOT, 'public/uploads/courses', f));
  await rm(pngPath);

  // delete the course through the UI
  await page.evaluate(() =>
    [...document.querySelectorAll('.drawer-head button')]
      .find((b) => b.textContent === 'Close')
      .click(),
  );
  await sleep(300);
  page.on('dialog', (d) => d.accept());
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) =>
      r.textContent.includes(name),
    );
    [...row.querySelectorAll('button')].find((b) => b.textContent === 'Delete').click();
  }, 'E2E Test Course');
  await sleep(900);
  check(
    !existsSync(join(ROOT, 'src/content/courses', created)),
    'deleting a course removes the content file',
  );

  // Reels tab: link validation + add + delete through the real UI
  for (const f of (await readdir(join(ROOT, 'src/content/reels'))).filter((x) =>
    x.startsWith('e2e-reel'),
  ))
    await rm(join(ROOT, 'src/content/reels', f));
  await page.goto(`${SITE}/admin/#reels`);
  await page.waitForSelector('table.table tbody tr');
  const reelsBefore = (await readdir(join(ROOT, 'src/content/reels'))).length;
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => /^Add reel$/.test(b.textContent)).click(),
  );
  await page.waitForSelector('.drawer input#f-instagram_url');
  // The drawer autofocuses its first field a moment after opening; without an explicit click the
  // typed name is split between two inputs (that once saved a stray reel named "E").
  await page.click('#f-student_name');
  await page.type('#f-student_name', 'E2E Reel Student');
  await page.type('#f-instagram_url', 'javascript:alert(1)');
  await page.evaluate(() =>
    [...document.querySelectorAll('.drawer-foot button')]
      .find((b) => b.textContent === 'Save')
      .click(),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some(
      (t) =>
        /must start with https/.test(t.textContent) || /Instagram reel link/.test(t.textContent),
    ),
  );
  check(
    (await readdir(join(ROOT, 'src/content/reels'))).length === reelsBefore,
    'a javascript: link is refused by the Reels form',
  );
  await page.$eval('#f-instagram_url', (el) => {
    el.value = 'https://example.com/not-instagram';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() =>
    [...document.querySelectorAll('.drawer-foot button')]
      .find((b) => b.textContent === 'Save')
      .click(),
  );
  await sleep(500);
  check(
    (await readdir(join(ROOT, 'src/content/reels'))).length === reelsBefore,
    'a non-Instagram link is refused',
  );
  await page.$eval('#f-instagram_url', (el) => {
    el.value = 'https://www.instagram.com/reel/E2eReelCode1/?igsh=abc';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() =>
    [...document.querySelectorAll('.drawer-foot button')]
      .find((b) => b.textContent === 'Save')
      .click(),
  );
  let reelFile;
  for (let i = 0; i < 30 && !reelFile; i++) {
    await sleep(200);
    reelFile = (await readdir(join(ROOT, 'src/content/reels'))).find((f) =>
      f.startsWith('e2e-reel-student'),
    );
  }
  check(!!reelFile, 'a valid Instagram link saves a new reel', reelFile);
  const reelBody = JSON.parse(await readFile(join(ROOT, 'src/content/reels', reelFile), 'utf8'));
  check(
    reelBody.instagram_url.includes('E2eReelCode1') &&
      reelBody.published === true &&
      reelBody.order > 6,
    'new reel is published and appended',
    JSON.stringify(reelBody),
  );
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) =>
      r.textContent.includes('E2E Reel Student'),
    );
    [...row.querySelectorAll('button')].find((b) => b.textContent === 'Delete').click();
  });
  await sleep(900);
  check(!existsSync(join(ROOT, 'src/content/reels', reelFile)), 'deleting a reel removes its file');

  // landing page + settings + home render
  for (const [hash, selector, name] of [
    ['landing-pages', 'table.table tbody tr', 'Landing Pages'],
    ['settings', '.section', 'Settings'],
    ['home', 'form.stack', 'Home Page'],
    ['resources', 'table.table tbody tr', 'Free Resources'],
    ['exam-updates', 'table.table tbody tr', 'Exam Updates'],
    ['teachers', 'table.table tbody tr', 'Teachers'],
    ['results', 'table.table tbody tr', 'Results'],
    ['reels', 'table.table tbody tr', 'Reels'],
    ['instagram', '.section', 'Instagram'],
  ]) {
    await page.goto(`${SITE}/admin/#${hash}`);
    await page
      .waitForSelector(selector, { timeout: 8000 })
      .then(() => ok(`${name} tab loads`))
      .catch(() => bad(`${name} tab loads`));
  }
  check(page.errors.length === 0, 'no console errors in admin', page.errors.join(' | '));
  await page.click('.who button');
  await page.waitForSelector('form.login');
  ok('logout returns to the login screen');
  await page.close();
}

/* ============================================================ instagram live feed */
console.log('\nInstagram live feed: connect in the admin, see it on the Home page');
{
  // Local mode: the dev backend accepts the token "demo" and serves sample posts without calling Instagram.
  await api('disconnectInstagram', { token });
  const homeSection = async (width = 390) => {
    const p = await newPage(width, width < 700);
    await p.evaluateOnNewDocument(() => sessionStorage.setItem('ccs_popup_shown', '1'));
    await open(p, '/');
    await sleep(2500); // the feed is requested when the page is idle
    return p;
  };
  const sectionState = (p) =>
    p.evaluate(() => {
      const root = document.querySelector('[data-ig-root]');
      return {
        hidden: root.hidden,
        cards: root.querySelectorAll('[data-ig-card]').length,
        heading: root.querySelector('[data-ig-heading]').textContent,
        handle: root.querySelector('[data-ig-handle]').hidden
          ? ''
          : `${root.querySelector('[data-ig-profile]').textContent} ${root.querySelector('[data-ig-profile]').href}`,
      };
    });

  let p = await homeSection();
  check(
    (await sectionState(p)).hidden,
    'with nothing connected the Instagram section is not on the Home page at all',
  );
  await p.close();

  // ---- admin: connect
  const adminPage = await newPage(1280, false);
  adminPage.on('dialog', (d) => d.accept());
  await open(adminPage, '/admin/');
  await adminPage.waitForSelector('form.login');
  await adminPage.type('form.login input[type=text]', LOGIN);
  await adminPage.type('form.login input[type=password]', PASSWORD);
  await adminPage.click('form.login button[type=submit]');
  await adminPage.waitForSelector('.topbar');
  await adminPage.goto(`${SITE}/admin/#instagram`);
  await adminPage.waitForSelector('form.inline-form input[type=password]');
  const steps = await adminPage.$eval(
    '.ig-steps',
    (d) => d.open && /Professional/.test(d.textContent),
  );
  check(steps, 'before connecting, the tab explains in plain words how to get the access token');
  check(
    await adminPage.$eval('form.inline-form input[type=password]', (i) => i.autocomplete === 'off'),
    'the token box is a password field (hidden while typing)',
  );
  await adminPage.type('form.inline-form input[type=password]', '!!');
  await adminPage.click('form.inline-form button[type=submit]');
  await adminPage.waitForSelector('.toast-error');
  ok('a token that is clearly not a token is refused with a message');
  await adminPage.$eval('form.inline-form input[type=password]', (i) => {
    i.focus();
    i.select();
  });
  await adminPage.type('form.inline-form input[type=password]', 'demo');
  await adminPage.click('form.inline-form button[type=submit]');
  await adminPage.waitForSelector('.ig-account');
  const connected = await adminPage.evaluate(() => ({
    who: document.querySelector('.ig-account').textContent,
    on: document.querySelector('.field-check input').checked,
    previews: document.querySelectorAll('.ig-preview li').length,
  }));
  check(
    /@ccs_demo/.test(connected.who),
    'after connecting, the tab names the Instagram account',
    connected.who,
  );
  check(connected.on, 'the feed is switched on by default');
  check(
    connected.previews === 8,
    'the tab previews the posts visitors will see',
    String(connected.previews),
  );
  check(
    !JSON.stringify(await api('getInstagram', { token })).match(/token/i),
    'the backend never sends the access token back, not even to an admin',
  );

  // ---- the Home page now shows it
  p = await homeSection();
  let st = await sectionState(p);
  check(
    !st.hidden && st.cards === 8,
    'the Home page now shows the Instagram section with 8 posts',
    JSON.stringify(st),
  );
  check(st.heading === 'Latest from our Instagram', 'with the default heading', st.heading);
  check(
    /@ccs_demo https:\/\/www\.instagram\.com\/ccs_demo\/$/.test(st.handle),
    'it links to the account',
    st.handle,
  );
  const cards = await p.$$eval('[data-ig-card]', (els) =>
    els.map((c) => ({
      kind: c.dataset.kind,
      code: c.dataset.code,
      loaded: c.querySelector('img').complete,
      label: c.getAttribute('aria-label'),
    })),
  );
  check(
    cards[0].kind === 'p' && cards[1].kind === 'reel',
    'photos and reels both appear, newest first',
    JSON.stringify(cards.slice(0, 2)),
  );
  check(
    cards.every((c) => c.label),
    'every card has a description for screen readers',
  );
  const w = await p.$eval('[data-ig-card]', (c) => Math.round(c.getBoundingClientRect().width));
  check(w <= 170, 'the cards are compact tiles on a phone', String(w));
  const sc = await p.$eval('[data-ig-track]', (t) => ({
    scrolls: t.scrollWidth > t.clientWidth,
    page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  check(
    sc.scrolls && sc.page,
    'the row swipes sideways without widening the page',
    JSON.stringify(sc),
  );
  await p.evaluate(() => document.querySelector('[data-ig-root]').scrollIntoView());
  await sleep(300);
  await p.click('[data-ig-card]');
  await p.waitForSelector('#ig-dialog[open] iframe');
  const d = await p.evaluate(() => {
    const dlg = document.getElementById('ig-dialog');
    const f = dlg.querySelector('iframe');
    return {
      src: f.src,
      sandbox: f.getAttribute('sandbox'),
      link: dlg.querySelector('[data-reel-link]').href,
      title: dlg.querySelector('[data-reel-title]').textContent,
    };
  });
  check(
    d.src === 'https://www.instagram.com/p/DemoPost001/embed/' &&
      d.link === 'https://www.instagram.com/p/DemoPost001/' &&
      d.title === '@ccs_demo',
    'tapping a post opens exactly that post in the player, with "Open on Instagram"',
    JSON.stringify(d),
  );
  check(
    d.sandbox.includes('allow-scripts') && !d.sandbox.includes('allow-top-navigation'),
    'the player is sandboxed (no top-level navigation)',
    d.sandbox,
  );
  await p.keyboard.press('Escape');
  await sleep(250);
  check(
    !(await p.$('#ig-dialog[open]')) && !(await p.$('#ig-dialog iframe')),
    'Escape closes it and removes the frame (playback stops)',
  );
  check(
    !p.errors.some((e) => /Refused to/.test(e)),
    'the Content-Security-Policy lets the section and the player load',
    p.errors.join(' | ').slice(0, 200),
  );
  await p.close();

  // a hostile or broken backend answer is ignored by the page
  const evil = await newPage(390);
  await evil.evaluateOnNewDocument(() => {
    sessionStorage.setItem('ccs_popup_shown', '1');
    sessionStorage.setItem(
      'ccs_ig_feed',
      JSON.stringify({
        t: Date.now(),
        feed: {
          enabled: true,
          heading: 'x',
          username: 'a"><img src=x onerror=alert(1)>',
          profile_url: 'javascript:alert(1)',
          posts: [
            { kind: 'p', code: 'AbCdEf12', image: 'javascript:alert(1)', caption: '<b>x</b>' },
            {
              kind: '../../x',
              code: 'AbCdEf12',
              image: 'https://evil.example.com/a.jpg',
              caption: '',
            },
            {
              kind: 'p',
              code: 'AbCdEf12',
              image: 'https://scontent.cdninstagram.com/a.jpg',
              caption: '<img src=x onerror=alert(1)>',
            },
          ],
        },
      }),
    );
  });
  await open(evil, '/');
  await sleep(1500);
  const bad_ = await evil.evaluate(() => ({
    cards: document.querySelectorAll('[data-ig-card]').length,
    injected: !!document.querySelector('[data-ig-track] [onerror], [data-ig-track] b'),
    images: document.querySelectorAll('[data-ig-track] img').length,
    handleHidden: document.querySelector('[data-ig-handle]').hidden,
  }));
  check(
    bad_.cards === 1 && bad_.images === 1 && !bad_.injected && bad_.handleHidden,
    'unsafe values in a feed are ignored: only the one valid post is drawn, captions are plain text, a bad profile link is dropped',
    JSON.stringify(bad_),
  );
  await evil.close();

  // ---- admin: change what is shown
  await adminPage.select('#ig-count', '3');
  await adminPage.$eval('#ig-heading', (i) => {
    i.focus();
    i.select();
  });
  await adminPage.type('#ig-heading', 'Follow us on Instagram');
  await adminPage.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save').click(),
  );
  await adminPage.waitForSelector('.toast-ok');
  p = await homeSection();
  st = await sectionState(p);
  check(
    st.cards === 3 && st.heading === 'Follow us on Instagram',
    'a changed count and heading show on the Home page at once, with no rebuild',
    JSON.stringify(st),
  );
  await p.close();

  await adminPage.click('.field-check input');
  await adminPage.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save').click(),
  );
  await adminPage.waitForFunction(() =>
    /hidden on the Home page/.test(document.querySelector('.toasts')?.textContent ?? ''),
  );
  p = await homeSection();
  check((await sectionState(p)).hidden, 'switching the feed off hides the section again');
  await p.close();

  // ---- admin: disconnect
  await adminPage.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Disconnect').click(),
  );
  await adminPage.waitForSelector('form.inline-form input[type=password]');
  check(
    (await api('getInstagram', { token })).connected === false &&
      (await api('instagramFeed')).posts.length === 0,
    'disconnecting forgets the account and empties the public feed',
  );
  // leave the dev backend as a fresh install would have it
  await api('saveInstagramSettings', {
    token,
    enabled: 'true',
    count: 8,
    heading: 'Latest from our Instagram',
  });
  check(
    adminPage.errors.length === 0,
    'no console errors in the Instagram tab',
    adminPage.errors.join(' | '),
  );
  await adminPage.close();
}

/* ============================================================ admin responsiveness */
console.log('\nAdmin has no horizontal page overflow (login + every tab)');
for (const width of [360, 390, 768, 1024, 1280]) {
  const page = await newPage(width, width < 700);
  await open(page, '/admin/');
  await page.waitForSelector('form.login');
  const overflowOf = () =>
    page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      document.documentElement.style.overflowX = 'visible';
      document.body.style.overflowX = 'visible';
      return { scrollW: document.documentElement.scrollWidth, vw };
    });
  let o = await overflowOf();
  check(o.scrollW <= o.vw, `login @${width}px`, JSON.stringify(o));
  await page.type('form.login input[type=text]', LOGIN);
  await page.type('form.login input[type=password]', PASSWORD);
  await page.click('form.login button[type=submit]');
  await page.waitForSelector('.topbar');
  for (const hash of [
    'enquiries',
    'home',
    'courses',
    'results',
    'reels',
    'instagram',
    'teachers',
    'resources',
    'exam-updates',
    'landing-pages',
    'settings',
  ]) {
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await sleep(700);
    o = await overflowOf();
    check(o.scrollW <= o.vw, `admin #${hash} @${width}px`, JSON.stringify(o));
    if (SHOTS && width === 390 && ['enquiries', 'home'].includes(hash))
      await page.screenshot({
        path: join(SHOTS, `e2e-admin-${hash}-${width}.png`),
        fullPage: true,
      });
    if (SHOTS && width === 1280)
      await page.screenshot({ path: join(SHOTS, `e2e-admin-${hash}-${width}.png`) });
  }
  await page.close();
}

/* ============================================================ deploy watcher */
console.log('\nAdmin: "live on the website" confirmation after a save');
{
  const page = await newPage(1280, false);
  // Speed up the 15-second polling interval so the test does not have to wait.
  await page.evaluateOnNewDocument(() => {
    const real = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => real(fn, ms === 15000 ? 200 : ms, ...a);
  });
  let builds = 0;
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = req.url();
    if (url.includes('/build.json')) {
      builds++;
      return req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: builds <= 1 ? 'build-A' : 'build-B' }),
      });
    }
    if (
      req.method() === 'POST' &&
      url.startsWith(API) &&
      /action=saveContent/.test(req.postData() ?? '')
    ) {
      // behave like production: the real backend does not say "local"
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: req.postData(),
      });
      const body = await r.json();
      delete body.local;
      return req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      });
    }
    return req.continue();
  });
  await open(page, '/admin/');
  await page.waitForSelector('form.login');
  await page.type('form.login input[type=text]', LOGIN);
  await page.type('form.login input[type=password]', PASSWORD);
  await page.click('form.login button[type=submit]');
  await page.waitForSelector('.topbar');
  await page.evaluate(() => {
    location.hash = 'courses';
  });
  await page.waitForSelector('table.table tbody tr input[type=checkbox]');
  const toggle = async () => {
    await page.evaluate(() =>
      document.querySelector('table.table tbody tr input[type=checkbox]').click(),
    );
  };
  await toggle();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      /Live on the website in about 2 minutes/.test(t.textContent),
    ),
  );
  ok('save shows "Saved. Live on the website in about 2 minutes."');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.toast')].some((t) => /Live now/.test(t.textContent)),
    { timeout: 15000 },
  );
  ok('a changed /build.json id triggers the "Live now" confirmation');
  await sleep(700);
  await toggle(); // put the course back
  await sleep(900);
  await page.close();
}

/* ============================================================ admin hardening */
console.log('\nAdmin hardening: fixed logins, change my password, anti-framing');
{
  // WHO can sign in is fixed in the code: the website cannot add, remove or reset an admin.
  for (const action of ['addAdmin', 'listAdmins', 'setAdminActive', 'resetAdminPassword']) {
    const r = await api(action, {
      token,
      email: 'e2e.new',
      name: 'E2E New',
      password: 'A-long-enough-password-12',
      active: 'true',
    });
    check(
      r.ok === false && /Unknown action/.test(r.error ?? ''),
      `the API has no "${action}": nobody can be added, removed or reset from the website`,
      JSON.stringify(r),
    );
  }
  check(
    (await api('login', { email: 'e2e.new', password: 'A-long-enough-password-12' })).ok === false,
    'a login that is not built in cannot be made to work',
  );
  check(
    (await api('login', { email: LOGIN, password: PASSWORD })).must_change === undefined,
    'signing in never forces a password change',
  );

  const NEW_PW = 'Better-pass-for-e2e-88';
  const oldSession = (await api('login', { email: LOGIN, password: PASSWORD })).token; // a second sign-in

  const page = await newPage(1280, false);
  await open(page, '/admin/');
  await page.type('form.login input[type=text]', LOGIN);
  await page.type('form.login input[type=password]', PASSWORD);
  await page.click('form.login button[type=submit]');
  await page.waitForSelector('.topbar');
  await page.goto(`${SITE}/admin/#settings`);
  await page.waitForSelector('fieldset.section');
  const settingsUi = await page.evaluate(() => ({
    legends: [...document.querySelectorAll('fieldset.section legend')].map((l) => l.textContent),
    note: document.body.innerText.includes('fixed by your developer'),
    addAdminForm: document.body.innerText.includes('Add an admin'),
    passwordBoxes: document.querySelectorAll('input[type=password]').length,
  }));
  check(
    settingsUi.legends.includes('Change my password') &&
      settingsUi.passwordBoxes === 3 &&
      settingsUi.note &&
      !settingsUi.addAdminForm &&
      !settingsUi.legends.includes('Admins'),
    'Settings has "Change my password" and a note that who can sign in is fixed, but no admin list or add-admin form',
    JSON.stringify(settingsUi),
  );

  // a wrong current password and a weak new one are refused on screen
  const [cur, next, again] = await page.$$('fieldset.section input[type=password]');
  await cur.type('not-my-password-1');
  await next.type(NEW_PW);
  await again.type(NEW_PW);
  await page.click('fieldset.section form.inline-form button[type=submit]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) =>
      /Current password is incorrect/.test(t.textContent),
    ),
  );
  ok('a wrong current password is refused on screen');
  check(
    (await api('login', { email: LOGIN, password: PASSWORD })).ok,
    'nothing changed after the refused attempt',
  );

  // the real change, through the screen
  // (a triple-click does not select the text of a password box, so clear it explicitly)
  await cur.evaluate((el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await cur.type(PASSWORD);
  await page.click('fieldset.section form.inline-form button[type=submit]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) => /Password changed/.test(t.textContent)),
  );
  ok('changing the password through the screen works');
  await page.goto(`${SITE}/admin/#enquiries`);
  await page.waitForSelector('table.table-enq tbody tr', { timeout: 15000 });
  ok('the browser that changed it stays signed in (fresh session)');

  check(
    (await api('login', { email: LOGIN, password: PASSWORD })).ok === false &&
      (await api('login', { email: LOGIN, password: NEW_PW })).ok,
    'the old password stops working and the new one works',
  );
  check(
    (await api('listEnquiries', { token: oldSession })).code === 'auth' &&
      (await api('listEnquiries', { token })).code === 'auth',
    'every other session that was signed in with the old password is signed out',
  );
  const weak = (await api('login', { email: LOGIN, password: NEW_PW })).token;
  check(
    (await api('changePassword', { token: weak, old_password: NEW_PW, new_password: 'short1' }))
      .ok === false,
    'a weak new password is refused by the server',
  );
  // put the default back so the rest of this run (and the next run) can sign in as before
  const restored = await api('changePassword', {
    token: weak,
    old_password: NEW_PW,
    new_password: PASSWORD,
  });
  check(
    restored.ok && !!restored.token,
    'the default password is restored for the rest of the run',
  );
  token = restored.token;
  await page.close();

  const host = await newPage(1000, false);
  await host.setContent(`<iframe id="f" src="${SITE}/admin/" width="800" height="500"></iframe>`);
  await sleep(1500);
  const inner = host.frames().find((f) => f.url().includes('/admin/'));
  const text = await inner.evaluate(() => document.body.innerText);
  check(
    /cannot be displayed inside another page/.test(text) && !/Admin login/.test(text),
    'the admin refuses to run inside a frame (clickjacking guard)',
    text.slice(0, 80),
  );
  await host.close();
}

/* ============================================================ slow or failing Google answers */
console.log(
  "\nGoogle's slow / failing answers: safe requests retry by themselves, writes never do",
);
{
  const GOOGLE_404 = '<html><body>Sorry, unable to open the file at present.</body></html>';
  const isApi = (r) => r.method() === 'POST' && r.url().startsWith(API);
  const actionOf = (r) => new URLSearchParams(r.postData() ?? '').get('action');

  // 1. sign-in: the first answer is Google's 404 page ("Unexpected response"); the page retries and signs in
  {
    const page = await newPage(1280, false);
    const seen = [];
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (isApi(r) && actionOf(r) === 'login') {
        seen.push('login');
        if (seen.length === 1)
          return r.respond({ status: 404, contentType: 'text/html', body: GOOGLE_404 });
      }
      r.continue();
    });
    await open(page, '/admin/');
    await page.type('form.login input[type=text]', LOGIN);
    await page.type('form.login input[type=password]', PASSWORD);
    await page.click('form.login button[type=submit]');
    await page.waitForSelector('.topbar', { timeout: 20000 });
    check(
      seen.length === 2 && !(await page.$('.login-error')),
      "sign-in survives Google's 404 page: it retries by itself and no error is shown",
      `login requests: ${seen.length}`,
    );
    await page.close();
  }

  // 2. sign-in: a slow answer shows a "still working" note instead of looking stuck, then succeeds
  {
    const page = await newPage(1280, false);
    await page.setRequestInterception(true);
    page.on('request', async (r) => {
      if (isApi(r) && actionOf(r) === 'login') await sleep(5500);
      r.continue().catch(() => {});
    });
    await open(page, '/admin/');
    await page.type('form.login input[type=text]', LOGIN);
    await page.type('form.login input[type=password]', PASSWORD);
    await page.click('form.login button[type=submit]');
    await page.waitForSelector('.login .help[role=status]', { timeout: 8000 });
    ok('a slow sign-in says "Still working" so nobody keeps clicking');
    await page.waitForSelector('.topbar', { timeout: 20000 });
    ok('...and then signs in');
    await page.close();
  }

  // 3. enquiry: the answer is lost AFTER the server saved it. The retry must not create a second enquiry.
  {
    const num = freshMobile();
    const page = await newPage(390);
    let posts = 0;
    await page.setRequestInterception(true);
    page.on('request', async (r) => {
      if (isApi(r) && actionOf(r) === 'submitEnquiry') {
        posts++;
        if (posts === 1) {
          // the server really receives it (so the row is saved) but the browser gets Google's error page
          await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: r.postData(),
          });
          return r.respond({ status: 404, contentType: 'text/html', body: GOOGLE_404 });
        }
      }
      r.continue().catch(() => {});
    });
    await open(page, '/');
    await sleep(400);
    await click(page, 'header [data-open-enquiry]');
    await page.waitForSelector('dialog[open] form');
    await page.type('dialog[open] input[name=name]', 'Lost Answer Test');
    await page.type('dialog[open] input[name=mobile]', num);
    await page.select('dialog[open] select[name=exam]', 'Other');
    await page.click('dialog[open] button[type=submit]');
    await page.waitForSelector('dialog[open] [role=status]', { timeout: 20000 });
    const rows = (await enquiryRows()).filter((r) => r.mobile === num);
    check(
      posts === 2 && rows.length === 1,
      'a lost answer is retried and shown as success, with exactly ONE enquiry saved (no duplicate)',
      `posts=${posts} rows=${rows.length}`,
    );
    await page.close();
  }

  // 4. a write is never repeated by the browser on its own
  {
    const page = await newPage(1280, false);
    let writes = 0;
    await open(page, '/admin/');
    await page.type('form.login input[type=text]', LOGIN);
    await page.type('form.login input[type=password]', PASSWORD);
    await page.click('form.login button[type=submit]');
    await page.waitForSelector('table.table-enq tbody tr');
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (isApi(r) && actionOf(r) === 'updateEnquiry') {
        writes++;
        return r.respond({ status: 404, contentType: 'text/html', body: GOOGLE_404 });
      }
      r.continue().catch(() => {});
    });
    const before = await page.$eval('table.table-enq tbody tr select', (el) => el.value);
    await page.select(
      'table.table-enq tbody tr select',
      before === 'Resolved' ? 'Open' : 'Resolved',
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.toast')].some((t) =>
        /busy|did not answer|Unexpected/i.test(t.textContent),
      ),
    );
    await sleep(2500); // long enough for any (wrong) automatic retry to have happened
    check(
      writes === 1,
      'a failed write (status change) is reported once and never repeated automatically',
      `update requests: ${writes}`,
    );
    await page.close();
  }

  // 5. change password: the server SAVES it but the answer is lost. The page must not claim it failed: it checks
  //    by signing in with the new password (safe to repeat), and keeps the browser signed in.
  {
    const NEW_PW = 'Lost-answer-test-pass-91';
    const page = await newPage(1280, false);
    let changes = 0;
    await open(page, '/admin/');
    await page.type('form.login input[type=text]', LOGIN);
    await page.type('form.login input[type=password]', PASSWORD);
    await page.click('form.login button[type=submit]');
    await page.waitForSelector('.topbar');
    await page.goto(`${SITE}/admin/#settings`);
    await page.waitForSelector('fieldset.section input[type=password]');
    await page.setRequestInterception(true);
    page.on('request', async (r) => {
      if (isApi(r) && actionOf(r) === 'changePassword') {
        changes++;
        await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: r.postData(),
        });
        return r.respond({ status: 404, contentType: 'text/html', body: GOOGLE_404 });
      }
      r.continue().catch(() => {});
    });
    const [cur, next, again] = await page.$$('fieldset.section input[type=password]');
    await cur.type(PASSWORD);
    await next.type(NEW_PW);
    await again.type(NEW_PW);
    await page.click('fieldset.section form.inline-form button[type=submit]');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.toast')].some((t) =>
          /Password changed.*saved/.test(t.textContent),
        ),
      { timeout: 20000 },
    );
    check(
      changes === 1,
      'a lost answer to "change password" is not repeated blindly, and the page confirms the outcome itself',
      `change requests: ${changes}`,
    );
    check(
      (await api('login', { email: LOGIN, password: PASSWORD })).ok === false &&
        (await api('login', { email: LOGIN, password: NEW_PW })).ok,
      '...and it says "saved" only because signing in with the new password really works',
    );
    await page.goto(`${SITE}/admin/#enquiries`);
    await page.waitForSelector('table.table-enq tbody tr', { timeout: 15000 });
    ok('the browser stays signed in after a confirmed change');
    // put the default back for the rest of the run
    const tok = (await api('login', { email: LOGIN, password: NEW_PW })).token;
    const back = await api('changePassword', {
      token: tok,
      old_password: NEW_PW,
      new_password: PASSWORD,
    });
    check(back.ok, 'the default password is restored for the rest of the run');
    token = back.token;
    await page.close();
  }
}

/* ============================================================ security edge cases */
console.log('\nSecurity edge cases (API)');
{
  check((await api('listEnquiries')).code === 'auth', 'no token: rejected');
  check(
    (await api('listEnquiries', { token: `${token.split('.')[0]}.${'0'.repeat(64)}` })).code ===
      'auth',
    'tampered signature: rejected',
  );
  const sig = token.split('.')[1];
  const forged = Buffer.from('admin.ccs.chandigar|99999999999999').toString('base64url');
  check(
    (await api('listEnquiries', { token: `${forged}.${sig}` })).code === 'auth',
    'forged expiry with a real signature: rejected',
  );
  for (const path of [
    '../package.json',
    'courses/../../package.json',
    '/etc/passwd',
    'courses/x.json%00.png',
    'courses/.json',
    'secrets/x.json',
  ]) {
    const r = await api('saveContent', { token, path, json: '{}', sha: '' });
    check(!r.ok, `saveContent rejects path "${path}"`);
  }
  check(
    !(await api('saveContent', { token, path: 'courses/x.json', json: '[]', sha: '' })).ok,
    'saveContent rejects non-object JSON',
  );
  check(
    !(
      await api('saveContent', {
        token,
        path: 'courses/x.json',
        json: '{"__proto__":{"a":1}}',
        sha: '',
      })
    ).ok,
    'saveContent rejects __proto__ keys',
  );
  check(
    !(
      await api('saveContent', {
        token,
        path: 'landing-pages/zzz.json',
        json: '{"slug":"other"}',
        sha: '',
      })
    ).ok,
    'landing page slug must match file name',
  );
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString(
    'base64',
  );
  check(
    !(await api('uploadFile', { token, folder: 'courses', filename: 'a.webp', base64: svg })).ok,
    'uploading an SVG disguised as .webp is rejected (checked by file bytes)',
  );
  check(
    !(await api('uploadFile', { token, folder: '../..', filename: 'a.webp', base64: svg })).ok,
    'upload folder allow-list enforced',
  );
  const dupe = freshMobile();
  const post = () =>
    api('submitEnquiry', {
      name: '=cmd|calc',
      mobile: dupe,
      exam: 'UPSC CSE',
      year: '2027',
      consent: 'yes',
      source: 'popup',
    });
  check((await post()).ok, 'formula-looking name accepted');
  const stored = (await enquiryRows()).find((r) => r.mobile === dupe);
  check(stored.name.startsWith("'="), 'formula-looking name stored neutralised', stored.name);
  check((await post()).code === 'duplicate', 'same mobile within 10 minutes is a duplicate');
  const hp = await api('submitEnquiry', {
    name: 'Bot',
    mobile: freshMobile(),
    exam: 'UPSC CSE',
    year: '2027',
    consent: 'yes',
    website: 'http://spam',
  });
  check(
    hp.ok && !(await enquiryRows()).some((r) => r.name === 'Bot'),
    'honeypot hit is silently dropped',
  );
  check(
    !(
      await api('submitEnquiry', {
        name: 'X',
        mobile: '1234567890',
        exam: 'UPSC CSE',
        year: '2027',
        consent: 'yes',
      })
    ).ok,
    'server validates the mobile number format',
  );
  // No lock-out: wrong passwords never block anyone (slow Google answers make people retry).
  const answers = [];
  for (let i = 0; i < 8; i++)
    answers.push((await api('login', { email: LOGIN, password: `wrong-${i}` })).code ?? 'wrong');
  check(
    answers.every((c) => c === 'wrong'),
    'wrong passwords are answered normally every time: no lock-out',
    answers.join(','),
  );
  check(
    (await api('login', { email: LOGIN, password: PASSWORD })).ok === true,
    'the right password still works straight after many wrong ones',
  );
}

await browser.close();
close();
console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
