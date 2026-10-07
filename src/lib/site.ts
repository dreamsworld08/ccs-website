import { getCollection, getEntry } from 'astro:content';

/** Base path without a trailing slash ('' on a custom domain, '/ccs-website' on github.io). */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const ABSOLUTE = /^(https?:|mailto:|tel:|sms:|#|\/\/|data:)/i;

/** Prefix an internal path with the base path. External URLs pass through untouched. */
export function withBase(path: string | undefined | null): string {
  if (!path) return `${BASE}/`;
  if (ABSOLUTE.test(path)) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  const [, pathname, suffix] = p.match(/^([^?#]*)(.*)$/)!;
  const withSlash =
    /\.[a-z0-9]+$/i.test(pathname) || pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${BASE}${withSlash}${suffix}`;
}

/**
 * Links typed into /admin (course buttons, exam-update links, resources...) are untrusted:
 * only http(s), mailto, tel, #anchors and site-relative paths survive; `javascript:` and
 * every other scheme collapse to the fallback.
 */
export function safeHref(url: string | undefined | null, fallback = ''): string {
  const u = (url ?? '').trim();
  if (!u) return fallback;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(u) || u.startsWith('#')) return u;
  if (u.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(u)) return fallback;
  return withBase(u);
}

/** Absolute URL for canonical / Open Graph tags. */
export function absoluteUrl(path: string, site: URL | string | undefined): string {
  if (/^https?:/i.test(path)) return path;
  return new URL(withBase(path), site ?? 'http://localhost:4321').toString();
}

export async function getSettings() {
  const entry = await getEntry('settings', 'site');
  return entry!.data;
}

export async function getHome() {
  const entry = await getEntry('home', 'home');
  return entry!.data;
}

const byOrder = <T extends { data: { order: number } }>(a: T, b: T) => a.data.order - b.data.order;

export async function getCourses() {
  return (await getCollection('courses', ({ data }) => data.published)).sort(byOrder);
}
export async function getTeachers() {
  return (await getCollection('teachers', ({ data }) => data.published)).sort(byOrder);
}
export async function getResults() {
  return (await getCollection('results', ({ data }) => data.published)).sort(byOrder);
}
/**
 * Reads an Instagram reel / post link and returns only its type and shortcode. The embed URL is then
 * rebuilt from those two validated parts, so nothing else typed into the admin can reach an iframe.
 */
export function instagramRef(url: string): { kind: 'reel' | 'p' | 'tv'; code: string } | null {
  const m = (url ?? '')
    .trim()
    .match(
      /^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,20})(?:[/?#]|$)/i,
    );
  if (!m) return null;
  const kind = m[1].toLowerCase();
  return { kind: kind === 'p' ? 'p' : kind === 'tv' ? 'tv' : 'reel', code: m[2] };
}

export async function getReels() {
  return (
    await getCollection(
      'reels',
      ({ data }) => data.published && instagramRef(data.instagram_url) !== null,
    )
  ).sort(byOrder);
}

export async function getResources() {
  return (await getCollection('resources', ({ data }) => data.published)).sort(byOrder);
}
export async function getExamUpdates() {
  return (await getCollection('exam-updates', ({ data }) => data.published)).sort((a, b) =>
    b.data.date.localeCompare(a.data.date),
  );
}
export async function getTests() {
  return (await getCollection('tests', ({ data }) => data.published)).sort((a, b) =>
    a.data.title.localeCompare(b.data.title),
  );
}
export async function getLandingPages() {
  return await getCollection('landing-pages', ({ data }) => data.published);
}

/** Digits only, for wa.me and tel: links. */
export const digits = (s: string) => s.replace(/\D/g, '');

export function whatsappLink(
  number: string,
  text = 'Hi CCS, I would like to know more about your courses.',
) {
  return `https://wa.me/${digits(number)}?text=${encodeURIComponent(text)}`;
}
export const telLink = (phone: string) => `tel:+${digits(phone).replace(/^0+/, '')}`;

/** YouTube video id from watch / share / embed / shorts URLs (or a bare id). */
export function youtubeId(url: string): string {
  if (!url) return '';
  const m =
    url.match(
      /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/,
    ) || url.match(/^([\w-]{11})$/);
  return m ? m[1] : '';
}
export const isMp4 = (url: string) => /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);

export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const EXAM_OPTIONS = ['UPSC CSE', 'Punjab PSC (PCS)', 'Punjab One Day Exams', 'Other'];

/** Maps a course category to the exam preselected in the enquiry form. */
export function examForCategory(category: string): string {
  if (category === 'UPSC CSE' || category === 'Optional') return 'UPSC CSE';
  if (category === 'Punjab PSC') return 'Punjab PSC (PCS)';
  if (category === 'Punjab One Day') return 'Punjab One Day Exams';
  return ''; // e.g. "Test series": let the student choose
}
