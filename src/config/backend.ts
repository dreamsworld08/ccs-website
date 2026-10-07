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
const PRODUCTION_URL = 'PASTE_APPS_SCRIPT_WEB_APP_URL_HERE';
const LOCAL_URL = 'http://localhost:8787';

export const BACKEND_URL: string =
  import.meta.env.PUBLIC_BACKEND_URL || (import.meta.env.DEV ? LOCAL_URL : PRODUCTION_URL);

export const BACKEND_CONFIGURED = !BACKEND_URL.startsWith('PASTE_');
export const IS_LOCAL_BACKEND = BACKEND_URL.startsWith('http://localhost');
