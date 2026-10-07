import { BACKEND_URL } from '../config/backend';

export type ApiResult<T = Record<string, unknown>> = {
  ok: boolean;
  error?: string;
  code?: string;
} & T;

/**
 * Google answers an Apps Script request in two hops, and the second one sometimes takes 10 to 30 seconds or comes
 * back as a Google error page ("Unexpected response"), even though the script itself finished in about a second.
 * So requests that are safe to repeat are retried automatically, each attempt with its own shorter time limit:
 *   - login, reading data: nothing changes on the server, so repeating is harmless;
 *   - submitEnquiry: the server already treats the same mobile number within 10 minutes as "received", and the form
 *     shows that as success, so a repeat can never create a second enquiry.
 * Anything that writes (saving content, uploads, status and notes, changing a password) is never repeated by the
 * browser on its own, because a repeat after a lost answer could apply it twice.
 */
const REPEATABLE = new Set([
  'login',
  'submitEnquiry',
  'instagramFeed',
  'listEnquiries',
  'listContent',
  'getContent',
  'getInstagram',
]);
const SLOW_START = new Set(['login', 'submitEnquiry', 'instagramFeed']); // small answers: give up on a stuck attempt early

type Params = Record<string, string | number | boolean | undefined | null>;

async function attempt<T>(
  action: string,
  params: Params,
  timeoutMs: number,
): Promise<ApiResult<T>> {
  const body = new URLSearchParams();
  body.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as ApiResult<T>;
    } catch {
      return {
        ok: false,
        error: 'The server is busy right now. Please try again in a moment.',
        code: 'bad_response',
      } as ApiResult<T>;
    }
  } catch {
    return {
      ok: false,
      error: 'The server did not answer in time. Check your connection and try again.',
      code: 'network',
    } as ApiResult<T>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST application/x-www-form-urlencoded to the backend (Apps Script web app or the
 * local dev server). A form-encoded body is a CORS "simple request", so there is no
 * preflight, which Apps Script cannot answer.
 */
export async function callBackend<T = Record<string, unknown>>(
  action: string,
  params: Params = {},
  timeoutMs = 25000,
): Promise<ApiResult<T>> {
  if (!REPEATABLE.has(action)) return attempt<T>(action, params, timeoutMs);
  const attempts = 3;
  const each = SLOW_START.has(action) ? Math.min(timeoutMs, 15000) : timeoutMs;
  let result = await attempt<T>(action, params, each);
  for (let i = 1; i < attempts; i++) {
    // Only Google's own failures are retried (an error page, or no answer in time), never a real answer.
    if (result.code !== 'bad_response' && !(SLOW_START.has(action) && result.code === 'network'))
      break;
    await new Promise((r) => setTimeout(r, 700 * i));
    result = await attempt<T>(action, params, each);
  }
  return result;
}
