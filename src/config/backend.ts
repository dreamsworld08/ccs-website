/**
 * Backend (Google Apps Script web app) URL.
 *
 * PRODUCTION: paste the deployed web app URL below
 *   (https://script.google.com/macros/s/XXXX/exec). The URL is public by design:
 *   every admin action is checked against a signed session token.
 *
 * LOCAL: `npm run dev` starts dev-server/server.mjs, a drop-in stand-in for the
 *   Apps Script backend that speaks exactly the same API, so no URL is needed.
 *   To test a production build against it, run `npm run build:local`.
 */
const PRODUCTION_URL =
  'https://script.google.com/macros/s/AKfycbyCCy2CNFOTQDvGdaJK39zESdvxRTy93LZ7e2iBK3MDfkdX1wFZ6P1zmIq7VMMf5Jm7/exec';
const LOCAL_URL = 'http://localhost:8787';

export const BACKEND_URL: string =
  import.meta.env.PUBLIC_BACKEND_URL || (import.meta.env.DEV ? LOCAL_URL : PRODUCTION_URL);

/**
 * The backend (google-apps-script/Code.gs, pasted by hand into Google) reports a version when someone signs in to the
 * admin. When it is lower than this, the admin shows a warning, because the pasted code is older than the website and some
 * saves may be refused. Raise this together with BACKEND_VERSION in Code.gs and dev-server/server.mjs
 * (`npm run test:gs` checks they agree).
 */
export const REQUIRED_BACKEND_VERSION = 3;

export const BACKEND_CONFIGURED = !BACKEND_URL.startsWith('PASTE_');
export const IS_LOCAL_BACKEND = BACKEND_URL.startsWith('http://localhost');
