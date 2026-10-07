// Layout QA: serves ./dist and loads every page at phone/tablet/desktop widths, failing on any
// horizontal overflow. The body's overflow clip is switched off first so it cannot hide a bug.
//   npm run build && npm run check:layout        (screenshots: SHOTS=/some/dir)
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { serveDist } from './lib/static-server.mjs';

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIST = new URL('../dist', import.meta.url).pathname;
const BASE = (process.env.BASE_PATH || '/').replace(/\/$/, '');
const WIDTHS = (process.env.WIDTHS || '320,360,375,390,412,430,768,1024,1280,1440')
  .split(',')
  .map(Number);
const ROUTES = (
  process.env.ROUTES ||
  '/,/about-teachers/,/courses/,/results/,/free-resources/,/exam-updates/,/lp/upsc-scholarship-test-2027/,/privacy-policy/,/search/?q=pyq,/404.html'
).split(',');
const SHOTS = process.env.SHOTS || '';
const STRESS_FONT = process.env.STRESS_FONT === '1'; // swap to a wide fallback font

const { port, close } = await serveDist(DIST, process.env.BASE_PATH || '/');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
let failures = 0;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage();
    await page.setBypassCSP(true); // the checker injects a <style>; the CSP itself is exercised by e2e.mjs
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text()))
        errors.push(`console: ${m.text()}`);
    });
    await page.setViewport({
      width,
      height: width < 700 ? 800 : 900,
      deviceScaleFactor: 1,
      isMobile: width < 700,
      hasTouch: width < 700,
    });
    await page
      .goto(`http://localhost:${port}${BASE}${route}`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      })
      .catch(() => {});
    await page.addStyleTag({
      content: `html,body{overflow-x:visible!important}${STRESS_FONT ? '*{font-family:Verdana,Geneva,sans-serif!important}' : ''}`,
    });
    const result = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const clipped = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).overflowX === 'visible') continue;
          const ar = a.getBoundingClientRect();
          // A clipping ancestor only helps if it is itself inside the viewport.
          if (ar.right <= vw + 1 && ar.left >= -1) return true;
        }
        return false;
      };
      const offenders = [];
      document.querySelectorAll('body *').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.position === 'fixed' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) {
          const name = (n) =>
            `${n.tagName.toLowerCase()}${n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 3).join('.') : ''}`;
          const chain = [];
          for (let a = el.parentElement, i = 0; a && i < 3; a = a.parentElement, i++)
            chain.push(name(a));
          offenders.push(
            `${name(el)} [${Math.round(r.left)}..${Math.round(r.right)}] in ${chain.join(' < ')}`,
          );
        }
      });
      return {
        vw,
        scrollW: document.documentElement.scrollWidth,
        offenders: offenders.slice(0, 6),
      };
    });
    const overflow = result.scrollW > result.vw;
    if (overflow || result.offenders.length || errors.length) {
      failures++;
      console.log(`FAIL ${route} @${width}: scrollWidth=${result.scrollW} vw=${result.vw}`);
      result.offenders.forEach((o) => console.log('   offender:', o));
      errors.forEach((e) => console.log('   ', e));
    }
    if (SHOTS && (width === 390 || width === 1440 || process.env.ALL_SHOTS)) {
      const name = (route === '/' ? 'home' : route.replace(/[^a-z0-9]+/gi, '_')) + `-${width}.png`;
      await page.screenshot({ path: join(SHOTS, name), fullPage: true });
    }
    await page.close();
  }
}
await browser.close();
close();
console.log(
  failures
    ? `\n${failures} failing checks`
    : `\nLayout OK: ${ROUTES.length} routes x ${WIDTHS.length} widths, no horizontal overflow`,
);
process.exit(failures ? 1 : 0);
