import { join } from 'node:path';
import sharp from 'sharp';
import { isMaster, plan } from '../../scripts/lib/image-variants.mjs';
import { withBase } from './site';

/**
 * Build-time only (never import this from a Preact island). Describes the responsive copies of an
 * uploaded picture. The copies themselves are written after the build by scripts/lib/optimize-uploads.mjs,
 * from the same plan, so the page and the files always match.
 */
export type Picture = {
  /** The upload itself: the fallback for browsers that understand neither WebP nor AVIF. */
  src: string;
  /** `srcset` values, or '' when the upload is too small to need smaller copies. */
  webp: string;
  avif: string;
};

const cache = new Map<string, Promise<Picture | null>>();

const srcset = (list: [number, string][]) =>
  list.map(([w, url]) => `${withBase(url)} ${w}w`).join(', ');

async function build(urlPath: string): Promise<Picture | null> {
  try {
    const meta = await sharp(join(process.cwd(), 'public', urlPath)).metadata();
    if (!meta.width) return null;
    const p = plan(urlPath, meta.width);
    return { src: withBase(urlPath), webp: srcset(p.webp), avif: srcset(p.avif) };
  } catch {
    return null; // missing or unreadable file: the plain <img> will show the same problem the old way
  }
}

/** Responsive sources for an uploaded WebP, or null when the picture should be shown as it is. */
export function pictureFor(urlPath: string | undefined | null): Promise<Picture | null> {
  // `astro dev` does not run the post-build step, so the copies do not exist there.
  if (!import.meta.env.PROD || !urlPath || !isMaster(urlPath)) return Promise.resolve(null);
  if (!cache.has(urlPath)) cache.set(urlPath, build(urlPath));
  return cache.get(urlPath)!;
}

/** One small, fixed-size copy for places that cannot use srcset (the search index). */
export async function thumbFor(urlPath: string | undefined | null): Promise<string> {
  if (!urlPath) return '';
  const pic = await pictureFor(urlPath);
  const copies = pic?.webp.split(', ') ?? [];
  // 640 px wide is sharp enough for a result card on a 3x phone and still only a few KB.
  const small =
    copies.find((c) => /\.640w\.webp /.test(c)) ?? copies.find((c) => /\.\d+w\.webp /.test(c));
  return small ? small.split(' ')[0] : withBase(urlPath);
}
