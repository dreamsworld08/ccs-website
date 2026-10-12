/**
 * The latest videos of the institute's YouTube channel for the Home page.
 *
 * They are read at BUILD time from YouTube's public channel feed (https://www.youtube.com/feeds/videos.xml?channel_id=...):
 * no API key, no cost, and nothing is requested from a visitor's browser until they press play, so the page does not
 * depend on YouTube answering. The deploy workflow rebuilds the site every hour, which keeps the list fresh.
 *
 * If YouTube cannot be reached during a build, the last good copy in src/data/youtube-snapshot.json is used, so a build
 * never fails and the section never disappears because of a network hiccup (`npm run youtube:refresh` updates that copy).
 *
 * Nothing here is trusted blindly: every id is checked against YouTube's own id shape before it reaches the page.
 */
export type Video = { id: string; title: string; published: string; short: boolean };
export type Snapshot = { source: string; channelId: string; videos: Video[] };

export const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

/** How many videos the Home page may show. */
export const MIN_COUNT = 3;
export const MAX_COUNT = 15; // the channel feed lists the newest 15

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A title as shown on a card: no hashtags (YouTube titles often end with a pile of them), single spaces, not too long. */
export function cleanTitle(raw: string): string {
  const title = decodeEntities(raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s*#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (title || decodeEntities(raw).replace(/\s+/g, ' ').trim()).slice(0, 120);
}

/** The channel feed (Atom XML) as a list of videos, newest first, keeping only well-formed entries. */
export function parseFeed(xml: string): Video[] {
  const videos: Video[] = [];
  for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    const id = entry.match(/<yt:videoId>([^<]*)<\/yt:videoId>/)?.[1]?.trim() ?? '';
    const title = entry.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    const published = entry.match(/<published>([^<]*)<\/published>/)?.[1]?.trim() ?? '';
    const link = entry.match(/<link rel="alternate" href="([^"]*)"/)?.[1] ?? '';
    if (!VIDEO_ID.test(id) || !/^\d{4}-\d{2}-\d{2}T/.test(published) || !title.trim()) continue;
    videos.push({ id, title: cleanTitle(title), published, short: link.includes('/shorts/') });
  }
  return videos.sort((a, b) => b.published.localeCompare(a.published));
}

/** Which videos the Home page shows: regular videos (Shorts only if asked), newest first, at most `count`. */
export function pickVideos(videos: Video[], opts: { count: unknown; shorts: boolean }): Video[] {
  const n = Math.round(Number(opts.count));
  const count = n > 0 ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, n)) : 8; // empty or unreadable: 8
  return videos.filter((v) => opts.shorts || !v.short).slice(0, count);
}

/** "12 Oct 2026", in Indian time so a late-night upload keeps its date. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/** Thumbnails come from YouTube's image host (allowed by the site's CSP). mq = 320x180, hq = 480x360 (cropped to 16:9 by the card). */
export const thumb = (id: string, size: 'mq' | 'hq') =>
  `https://i.ytimg.com/vi/${id}/${size}default.jpg`;

/** A normal form of the channel link, so the saved copy can tell whether it belongs to the channel now in the settings. */
export const normalizeChannelUrl = (url: string) =>
  (url ?? '')
    .trim()
    .toLowerCase()
    .replace(/^http:/, 'https:')
    .replace(/\/+$/, '')
    .replace('://youtube.com', '://www.youtube.com');

export function channelIdFromUrl(url: string): string | null {
  return url.match(/youtube\.com\/channel\/(UC[\w-]{22})(?:[/?#]|$)/i)?.[1] ?? null;
}
/** The channel id inside a channel page (for links like https://www.youtube.com/@handle). */
export function channelIdFromPage(html: string): string | null {
  const id =
    html.match(/rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] ??
    html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ??
    html.match(/"channelId":"(UC[\w-]{22})"/)?.[1];
  return id && CHANNEL_ID.test(id) ? id : null;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function get(url: string, fetcher: Fetcher, ms = 12000): Promise<string> {
  const res = await fetcher(url, {
    signal: AbortSignal.timeout(ms),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CCS-site-build)', 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * The videos for the channel in the settings: fresh from YouTube when possible, else the saved copy (only if it is
 * for the same channel), else nothing (the Home page then simply leaves the section out).
 */
export async function loadChannelVideos(
  channelUrl: string,
  snapshot: Snapshot | undefined,
  fetcher: Fetcher = fetch,
): Promise<{ videos: Video[]; channelId: string; fresh: boolean }> {
  const source = normalizeChannelUrl(channelUrl);
  const saved = snapshot && snapshot.source === source ? snapshot : undefined;
  try {
    let channelId = channelIdFromUrl(channelUrl) ?? saved?.channelId ?? null;
    if (!channelId && /^https:\/\/(www\.)?youtube\.com\//i.test(channelUrl.trim()))
      channelId = channelIdFromPage(await get(channelUrl.trim(), fetcher));
    if (!channelId) throw new Error('could not find the channel id');
    const videos = parseFeed(await get(FEED + channelId, fetcher));
    if (!videos.length) throw new Error('the feed had no videos');
    return { videos, channelId, fresh: true };
  } catch (err) {
    console.warn(
      `[youtube] could not read the channel feed (${(err as Error).message}); ${saved ? 'using the saved copy' : 'leaving the section out'}.`,
    );
    return { videos: saved?.videos ?? [], channelId: saved?.channelId ?? '', fresh: false };
  }
}

/** Remembers the answer for ten minutes, so `npm run dev` does not ask YouTube again on every page view (a build asks once). */
const memo = new Map<string, { at: number; result: ReturnType<typeof loadChannelVideos> }>();
export function getChannelVideos(channelUrl: string, snapshot: Snapshot | undefined) {
  const key = normalizeChannelUrl(channelUrl);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.result;
  const result = loadChannelVideos(channelUrl, snapshot);
  memo.set(key, { at: Date.now(), result });
  return result;
}
