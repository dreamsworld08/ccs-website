import { callBackend, type ApiResult } from '../lib/api';
import { uploadName } from '../lib/upload-name';

export type Session = {
  token: string;
  name: string;
  email: string;
  expiresAt: number;
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
  timeoutMs = 60000,
): Promise<ApiResult<T>> {
  const s = loadSession();
  const res = await callBackend<T>(action, { ...params, token: s?.token ?? '' }, timeoutMs);
  if (res.code === 'auth') {
    clearSession();
    window.dispatchEvent(new Event('ccs:session-expired'));
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

export async function saveItem(path: string, data: object, sha: string): Promise<SaveResult> {
  // Never save a link to a picture that is still on its way, or that never arrived.
  const problem = await unfinishedUploads(data);
  if (problem) return { ok: false, error: problem };
  return call('saveContent', { path, json: JSON.stringify(withStoredNames(data)), sha });
}
export function deleteItem(path: string, sha: string): Promise<SaveResult> {
  return call('deleteContent', { path, sha });
}
/**
 * Pictures uploaded in this session. In production a new file only exists on the live site after the
 * rebuild (about 2 minutes), so previews use the bytes we just sent instead of a link that would 404.
 */
const justUploaded = new Map<string, string>();
/** Uploads still on their way, and the paths of uploads that gave up: a record that mentions either is not saved. */
const running = new Map<string, Promise<ApiResult<{ path: string }>>>();
const failed = new Set<string>();
/**
 * The address the server really stored a file under, when it differs from the one we asked for. The current backend
 * keeps the name the browser chose, but a backend that has not been updated yet (see google-apps-script/Code.gs) picks
 * its own name and answers with it. The answer is the truth: records must use it, or the picture would not be found.
 */
const storedAs = new Map<string, string>();
const actualPath = (path: string) => storedAs.get(path) ?? path;

/**
 * Starts uploading a picture or PDF and returns its final address AT ONCE, so the form can use it straight away and the
 * admin never waits on Google. The browser chooses the file name, which makes the upload safe to repeat: if Google
 * loses the answer, the automatic retry is recognised by the server as the same file and nothing is stored twice.
 * Saving waits for the upload to finish (see saveItem), so a record can never point at a file that is not there.
 */
export function startUpload(folder: string, filename: string, base64: string, ext: 'webp' | 'pdf') {
  const name = uploadName(filename, ext);
  const path = `/uploads/${folder}/${name}`;
  if (ext === 'webp') justUploaded.set(path, `data:image/webp;base64,${base64}`);
  const done = call<{ path: string }>('uploadFile', { folder, filename, name, base64 }, 45000).then(
    (res) => {
      running.delete(path);
      if (!res.ok) {
        failed.add(path);
        justUploaded.delete(path);
      } else if (res.path && res.path !== path) {
        storedAs.set(path, res.path);
        if (ext === 'webp') justUploaded.set(res.path, `data:image/webp;base64,${base64}`);
      }
      return res;
    },
  );
  running.set(path, done);
  return { path, done };
}

/** `data` with every picture or PDF address replaced by the one the server really used (see storedAs). */
function withStoredNames<T>(v: T): T {
  if (typeof v === 'string') return actualPath(v) as T;
  if (Array.isArray(v)) return v.map(withStoredNames) as T;
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withStoredNames(x)])) as T;
  return v;
}

function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsIn(x, out));
  return out;
}

/** Waits for any picture or PDF in `data` that is still uploading. Returns a message when one did not make it. */
async function unfinishedUploads(data: unknown): Promise<string> {
  const used = stringsIn(data);
  for (const path of used) await running.get(path);
  if (used.some((s) => failed.has(s)))
    return 'A picture did not finish uploading, so nothing was saved. Please upload it again.';
  return '';
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
