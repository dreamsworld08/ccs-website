import { callBackend, type ApiResult } from '../lib/api';

export type Session = {
  token: string;
  name: string;
  email: string;
  expiresAt: number;
  mustChange?: boolean;
};
const KEY = 'ccs_admin_session';

/** The token lives in sessionStorage only: closing the tab logs the admin out. */
export function loadSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null') as Session | null;
    if (s && s.expiresAt > Date.now()) return s;
  } catch {
    /* ignore */
  }
  return null;
}
export function saveSession(s: Session) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Authenticated call. An expired or invalid token logs the admin out everywhere. */
export async function call<T = Record<string, unknown>>(
  action: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<ApiResult<T>> {
  const s = loadSession();
  const res = await callBackend<T>(action, { ...params, token: s?.token ?? '' }, 60000);
  if (res.code === 'auth') {
    clearSession();
    window.dispatchEvent(new Event('ccs:session-expired'));
  } else if (res.code === 'must_change') {
    window.dispatchEvent(new Event('ccs:must-change'));
  }
  return res;
}

export type Item<T = Record<string, any>> = { path: string; sha: string; data: T };
export type SaveResult = ApiResult<{ sha?: string; local?: boolean; current?: Item | null }>;

export async function listItems(folder: string): Promise<Item[] | null> {
  const res = await call<{ items: Item[] }>('listContent', { folder });
  return res.ok ? res.items : null;
}
export const getItem = (path: string) => call<Item>('getContent', { path });

export function saveItem(path: string, data: object, sha: string): Promise<SaveResult> {
  return call('saveContent', { path, json: JSON.stringify(data), sha });
}
export function deleteItem(path: string, sha: string): Promise<SaveResult> {
  return call('deleteContent', { path, sha });
}
/**
 * Pictures uploaded in this session. In production a new file only exists on the live site after the
 * rebuild (about 2 minutes), so previews use the bytes we just sent instead of a link that would 404.
 */
const justUploaded = new Map<string, string>();

export async function uploadFile(folder: string, filename: string, base64: string) {
  const res = await call<{ path: string; local?: boolean }>('uploadFile', {
    folder,
    filename,
    base64,
  });
  if (res.ok && /\.webp$/i.test(res.path)) {
    justUploaded.set(res.path, `data:image/webp;base64,${base64}`);
  }
  return res;
}

/** Base path of the public site (admin lives at <base>/admin/). */
export const siteBase = () => (document.documentElement.dataset.base ?? '').replace(/\/$/, '');
export const sitePath = (p: string) => `${siteBase()}${p.startsWith('/') ? p : `/${p}`}`;
/** Preview URL for a stored upload path ("/uploads/x.webp") or an external image. */
export const assetUrl = (p: string) =>
  justUploaded.get(p) ?? (/^(https?:|data:)/i.test(p) ? p : sitePath(p));

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'item';
export const shortId = () => Math.random().toString(36).slice(2, 6);
