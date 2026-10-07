// Builds every logo / favicon file the site uses from the school's logo artwork in brand/.
//   npm run brand
//
// Source:  brand/ccs-logo.png   the cut-out logo (500 x 500, transparent). The raster is the source on purpose:
//                               brand/ccs-logo.svg is an automatic trace of it, which is rough when enlarged
//                               (the small tagline turns to mush) and weighs 360 KB, far too heavy for a header.
//          brand/og-base.png    the social-share card without the logo corner badge
// Output:  public/brand/logo-mark.webp  the emblem alone: header, footer and admin
//          public/brand/logo-full.webp  the whole lockup: admin sign-in
//          public/brand/logo-full.png   same, for search engines (structured data)
//          public/favicon.ico, icon-192.png, icon-512.png, apple-touch-icon.png, site.webmanifest
//          public/og-default.png        the share card with the new emblem in the corner
// Safe to re-run: every file is rebuilt from the sources, nothing else is touched.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'brand/ccs-logo.png';
const OG_BASE = 'brand/og-base.png';
mkdirSync('public/brand', { recursive: true });

// The emblem (shield + wreath + "SINCE 2020") sits in the top of the artwork, above the lettering.
// Measured on the 500 px artwork: x 89..411, y 15..333; lettering starts at y 340.
const EMBLEM = { left: 84, top: 8, width: 332, height: 332 };

const emblem = () => sharp(SRC).extract(EMBLEM);
const full = () => sharp(SRC);
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** The emblem on a white rounded square: readable on dark browser tabs and home screens. */
async function tile(size, { radius = 0.22, inset = 0.88, round = true } = {}) {
  const inner = Math.round(size * inset);
  const mark = await emblem()
    .resize(inner, inner, { fit: 'contain', background: { ...WHITE, alpha: 0 } })
    .png()
    .toBuffer();
  const r = Math.round(size * radius);
  const base = sharp({ create: { width: size, height: size, channels: 4, background: WHITE } });
  const out = base.composite([{ input: mark, gravity: 'centre' }]);
  if (!round) return out.png({ palette: true, quality: 95, effort: 10 }).toBuffer();
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`,
  );
  return sharp(await out.png().toBuffer())
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ palette: true, quality: 95, effort: 10 })
    .toBuffer();
}

/** A .ico file holding PNG images (every current browser reads these). */
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...images.map((i) => i.data)]);
}

const write = (file, data) => {
  writeFileSync(file, data);
  console.log(`  ${file}  ${(data.length / 1024).toFixed(1)} KB`);
};

console.log('Logo files:');
write(
  'public/brand/logo-mark.webp',
  await emblem().resize(144, 144).webp({ quality: 90, alphaQuality: 100 }).toBuffer(),
);
write(
  'public/brand/logo-full.webp',
  await full().resize(320, 320).webp({ quality: 90, alphaQuality: 100 }).toBuffer(),
);
write(
  'public/brand/logo-full.png',
  await full().png({ palette: true, quality: 90, effort: 10 }).toBuffer(),
);

console.log('Favicons:');
write(
  'public/favicon.ico',
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        data: await tile(size, { inset: 0.94, radius: 0.2 }),
      })),
    ),
  ),
);
write('public/icon-192.png', await tile(192));
write('public/icon-512.png', await tile(512));
write('public/apple-touch-icon.png', await tile(180, { round: false, inset: 0.84 })); // iOS rounds the corners itself
write(
  'public/site.webmanifest',
  JSON.stringify(
    {
      name: 'Chandigarh Civil Services',
      short_name: 'CCS',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: 'browser',
    },
    null,
    2,
  ) + '\n',
);

console.log('Share card:');
// The old corner badge (a 72 px square at 1056,506) is covered by a slightly larger white tile with the emblem.
const BADGE = 132;
const badge = await tile(BADGE, { radius: 0.2, inset: 0.86 });
write(
  'public/og-default.png',
  await sharp(OG_BASE)
    .composite([{ input: badge, left: 1200 - 40 - BADGE, top: 630 - 48 - BADGE }])
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
