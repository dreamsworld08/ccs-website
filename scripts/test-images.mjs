// Tests the responsive-image pipeline (scripts/lib/image-variants.mjs + optimize-uploads.mjs) on real
// pictures in a temporary folder. No Astro build needed.
//   npm run test:images
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { WIDTHS, isMaster, plan } from './lib/image-variants.mjs';
import { writeVariants } from './lib/optimize-uploads.mjs';

let pass = 0;
let fail = 0;
const check = (cond, name, extra = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` ${extra}`}`);
};

/** A photo-like picture: smooth colour, texture and sensor noise, so compression behaves realistically. */
async function photo(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const noise = (Math.random() - 0.5) * 22;
      const texture = 16 * Math.sin(x / 9) * Math.cos(y / 13) + 10 * Math.sin((x + y) / 31);
      raw[i] = Math.max(0, Math.min(255, 100 + 80 * Math.sin(x / (width / 6)) + texture + noise));
      raw[i + 1] = Math.max(
        0,
        Math.min(255, 110 + 70 * Math.cos(y / (height / 5)) + texture + noise),
      );
      raw[i + 2] = Math.max(0, Math.min(255, 140 + 60 * Math.sin((x + y) / (width / 3)) + noise));
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .blur(0.8)
    .webp({ quality: 82 })
    .toBuffer();
}

console.log('plan() and isMaster()');
check(WIDTHS.join() === '400,640,960,1280', 'copies are made at 400, 640, 960 and 1280 px');
check(isMaster('/uploads/teachers/a-1.webp'), 'an uploaded WebP is processed');
check(!isMaster('/uploads/teachers/a-1.400w.webp'), 'a generated copy is never processed again');
check(!isMaster('/uploads/placeholders/person-1.svg'), 'SVG artwork is left alone');
check(!isMaster('/logo.svg') && !isMaster('/uploads/a.png'), 'other files are left alone');
const small = plan('/uploads/x/a-1.webp', 300);
check(
  small.files.length === 1 && small.files[0].url === '/uploads/x/a-1.avif',
  'a 300 px upload only gets an AVIF twin',
);
const mid = plan('/uploads/x/a-1.webp', 900);
check(
  mid.webp.map((c) => c[0]).join() === '400,640,900' &&
    mid.avif.map((c) => c[0]).join() === '400,640,900',
  'a 900 px upload is offered at 400, 640 and its own size (never upscaled)',
  mid.webp.join(' '),
);
check(
  plan('/uploads/x/a-1.webp', 1600)
    .webp.map((c) => c[0])
    .join() === '400,640,960,1280,1600',
  'a 1600 px upload gets every step',
);
check(
  plan('/uploads/x/a-1.webp', 1300)
    .webp.map((c) => c[0])
    .join() === '400,640,960,1300',
  'a step is skipped when the upload is not clearly wider than it',
);

console.log('\nwriteVariants() on real pictures');
const root = await mkdtemp(join(tmpdir(), 'ccs-images-'));
const publicDir = join(root, 'public');
const distDir = join(root, 'dist');
const put = async (rel, data) => {
  const file = join(publicDir, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
};
const master = await photo(900, 1125);
await put('uploads/teachers/amit-1.webp', master);
await put('uploads/home/hero-2.webp', await photo(1600, 900));
await put('uploads/results/tiny-3.webp', await photo(300, 375));
await put('uploads/placeholders/person-1.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
await put('uploads/resources/notes-4.pdf', '%PDF-1.4');
await put('uploads/courses/broken-5.webp', 'this is not an image');

const warnings = [];
const { written } = await writeVariants(publicDir, distDir, (m) => warnings.push(m));
const exists = (rel) =>
  stat(join(distDir, rel))
    .then(() => true)
    .catch(() => false);
const size = async (rel) => (await stat(join(distDir, rel))).size;
const dims = async (rel) => {
  const m = await sharp(join(distDir, rel)).metadata();
  return `${m.width}x${m.height} ${m.format}`;
};

for (const p of plan('/uploads/teachers/amit-1.webp', 900).files) {
  check(await exists(p.url), `wrote ${p.url}`);
}
check(
  (await dims('uploads/teachers/amit-1.400w.webp')) === '400x500 webp',
  'the 400 px copy keeps the proportions (400x500)',
);
check(
  (await dims('uploads/teachers/amit-1.640w.avif')) === '640x800 heif',
  'the AVIF copy really is an AVIF (640x800)',
);
check(
  (await dims('uploads/teachers/amit-1.avif')) === '900x1125 heif',
  "the full-size AVIF has the upload's own size",
);
const masterBytes = master.length;
const w400 = await size('uploads/teachers/amit-1.400w.webp');
const w640 = await size('uploads/teachers/amit-1.640w.webp');
check(
  w400 < w640 && w640 < masterBytes,
  `smaller pictures are smaller files (${w400} < ${w640} < ${masterBytes} bytes)`,
);
check(
  w400 < masterBytes * 0.5,
  `a phone copy is under half the upload (${Math.round((w400 / masterBytes) * 100)}%)`,
);
const a640 = await size('uploads/teachers/amit-1.640w.avif');
check(a640 < w640, `AVIF is smaller than WebP at the same size (${a640} < ${w640} bytes)`);
check(
  (await exists('uploads/home/hero-2.1280w.avif')) &&
    !(await exists('uploads/home/hero-2.1600w.avif')),
  'a 1600 px hero gets a 1280 px step and an AVIF at 1600 (named without a width)',
);
check(
  (await exists('uploads/results/tiny-3.avif')) &&
    !(await exists('uploads/results/tiny-3.400w.webp')),
  'a tiny upload gets no smaller copies',
);
check(
  !(await exists('uploads/placeholders/person-1.svg')),
  'SVG artwork is not copied or converted',
);
check(!(await exists('uploads/resources/notes-4.avif')), 'PDFs are ignored');
check(
  warnings.length === 1 &&
    /broken-5\.webp/.test(warnings[0]) &&
    !(await exists('uploads/courses/broken-5.avif')),
  'a file that is not a picture is reported and skipped without stopping the build',
  warnings.join(' | '),
);
const names = (await readdir(join(distDir, 'uploads/teachers'))).sort();
check(
  names.length === 5 && !names.includes('amit-1.webp'),
  'only the copies are written to dist (the upload itself comes from public/ as usual)',
  names.join(','),
);
check(written === 5 + 9 + 1, `wrote exactly the planned number of files (${written})`);
check(
  (await readFile(join(publicDir, 'uploads/teachers/amit-1.webp'))).equals(master),
  'the original upload is never modified',
);

await rm(root, { recursive: true, force: true });
console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
