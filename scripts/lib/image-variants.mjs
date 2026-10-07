// Responsive copies of every uploaded picture, made at build time.
//
// The admin panel uploads ONE good WebP per picture (public/uploads/<folder>/<name>.webp). The build then
// writes smaller WebP and AVIF copies next to it in dist/, so a phone downloads a picture sized for its
// screen instead of the full upload, in the smallest format it understands:
//
//   /uploads/teachers/amit-171.webp          the upload (also the fallback for very old browsers)
//   /uploads/teachers/amit-171.400w.webp     } WebP and AVIF at 400, 640, 960 and 1280 px wide, but only
//   /uploads/teachers/amit-171.400w.avif     } the widths the upload is actually larger than
//   /uploads/teachers/amit-171.avif          AVIF at the upload's own size
//
// Nothing here is committed to git: the names are a pure function of the upload's width, so the page
// (src/lib/images.ts) and the build (scripts/lib/optimize-uploads.mjs) always agree.
export const WIDTHS = [400, 640, 960, 1280];
// A copy is only made when the upload is clearly wider than it (otherwise it would be pointless).
const MIN_RATIO = 1.1;

/** Only the WebP files the admin uploads are processed; variants and other formats are served as they are. */
export const isMaster = (urlPath) =>
  /^\/uploads\/.+\.webp$/i.test(urlPath) && !/\.\d+w\.(webp|avif)$/i.test(urlPath);

const stem = (urlPath) => urlPath.replace(/\.webp$/i, '');

/**
 * Every file the build must write for an upload that is `width` px wide, and the srcset candidates the page
 * should offer. Returns `{ files: [{ url, width, format }], webp: [[width, url]], avif: [[width, url]] }`.
 */
export function plan(urlPath, width) {
  const widths = WIDTHS.filter((w) => width >= w * MIN_RATIO);
  const files = [];
  const webp = [];
  const avif = [];
  for (const w of widths) {
    for (const [format, list] of [
      ['webp', webp],
      ['avif', avif],
    ]) {
      const url = `${stem(urlPath)}.${w}w.${format}`;
      files.push({ url, width: w, format });
      list.push([w, url]);
    }
  }
  // The upload itself is the largest WebP; its AVIF twin is generated at the same size.
  webp.push([width, urlPath]);
  const full = `${stem(urlPath)}.avif`;
  files.push({ url: full, width, format: 'avif' });
  avif.push([width, full]);
  return { files, webp, avif };
}

export const ENCODE = {
  webp: { quality: 78, effort: 4 },
  // Quality 55 is visually equal to WebP 78 for photos and about 40% smaller.
  avif: { quality: 55, effort: 3 },
};
