// Astro integration: after the build, write the responsive WebP / AVIF copies described in
// scripts/lib/image-variants.mjs into dist/uploads. Reads public/uploads, writes only into dist.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ENCODE, isMaster, plan } from './image-variants.mjs';

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // no uploads yet
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Writes the variants for every upload. Returns how many files were written (used by the tests). */
export async function writeVariants(publicDir, distDir, log = () => {}) {
  const uploads = join(publicDir, 'uploads');
  let written = 0;
  let bytes = 0;
  for await (const file of walk(uploads)) {
    const urlPath = `/${relative(publicDir, file).split(sep).join('/')}`;
    if (!isMaster(urlPath)) continue;
    let meta;
    try {
      meta = await sharp(file).metadata();
    } catch (err) {
      log(`skipped ${urlPath}: ${err.message}`);
      continue;
    }
    const { files } = plan(urlPath, meta.width ?? 0);
    await Promise.all(
      files.map(async ({ url, width, format }) => {
        const out = join(distDir, url);
        const image = sharp(file).resize({ width, withoutEnlargement: true });
        const data = await (
          format === 'avif' ? image.avif(ENCODE.avif) : image.webp(ENCODE.webp)
        ).toBuffer();
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, data);
        written += 1;
        bytes += data.length;
      }),
    );
  }
  return { written, bytes };
}

export default function optimizeUploads() {
  let publicDir = '';
  return {
    name: 'ccs-optimize-uploads',
    hooks: {
      'astro:config:done': ({ config }) => {
        publicDir = fileURLToPath(config.publicDir);
      },
      'astro:build:done': async ({ dir, logger }) => {
        const { written, bytes } = await writeVariants(publicDir, fileURLToPath(dir), (m) =>
          logger.warn(m),
        );
        if (written)
          logger.info(`wrote ${written} responsive image copies (${Math.round(bytes / 1024)} KB)`);
      },
    },
  };
}
