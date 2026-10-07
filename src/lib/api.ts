import { BACKEND_URL } from '../config/backend';

export type ApiResult<T = Record<string, unknown>> = {
  ok: boolean;
  error?: string;
  code?: string;
} & T;

/**
 * POST application/x-www-form-urlencoded to the backend (Apps Script web app or the
 * local dev server). A form-encoded body is a CORS "simple request", so there is no
 * preflight, which Apps Script cannot answer.
 */
export async function callBackend<T = Record<string, unknown>>(
  action: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
  timeoutMs = 25000,
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
        error: 'Unexpected response from the server.',
        code: 'bad_response',
      } as ApiResult<T>;
    }
  } catch {
    return {
      ok: false,
      error: 'Network error. Check your connection and try again.',
      code: 'network',
    } as ApiResult<T>;
  } finally {
    clearTimeout(timer);
  }
}
