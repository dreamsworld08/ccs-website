// Lists (and optionally deletes) uploaded files that no page uses any more.
//
// When staff replace a picture or delete an item, the old file stays in public/uploads/: it is still on
// GitHub and still downloadable from the live site by anyone who knows the address (for example an old
// photo of a student). Run this now and then, as the developer:
//
//   npm run prune:uploads              show what is unused (changes nothing)
//   npm run prune:uploads -- --delete  delete the unused files, then commit and push
//
// A file counts as used when its path appears anywhere in src/ (content JSON, components, pages).
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = /\.(json|astro|ts|tsx|mjs|css|md)$/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let text = '';
for await (const file of walk(join(root, 'src'))) {
  if (SOURCE.test(file)) text += `${await readFile(file, 'utf8')}\n`;
}

const unused = [];
let bytes = 0;
for await (const file of walk(join(root, 'public', 'uploads'))) {
  const url = `/${relative(join(root, 'public'), file).split(sep).join('/')}`;
  if (url.startsWith('/uploads/placeholders/')) continue; // sample artwork that ships with the site
  if (text.includes(url)) continue;
  const { size } = await stat(file);
  unused.push({ file, url, size });
  bytes += size;
}

if (!unused.length) {
  console.log('Every uploaded file is in use. Nothing to remove.');
  process.exit(0);
}
for (const u of unused) console.log(`${String(Math.ceil(u.size / 1024)).padStart(6)} KB  ${u.url}`);
console.log(`\n${unused.length} unused file(s), ${Math.ceil(bytes / 1024)} KB.`);

if (process.argv.includes('--delete')) {
  for (const u of unused) await rm(u.file);
  console.log('Deleted. Commit and push to remove them from the live site.');
} else {
  console.log('Nothing was changed. Run with --delete to remove them.');
}
