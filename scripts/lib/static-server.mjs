// Minimal static file server for ./dist (used by the QA scripts). Honours BASE_PATH.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.xml': 'text/xml',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
};

export function serveDist(distDir, basePath = '/') {
  const base = basePath.replace(/\/$/, '');
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
    let file = normalize(join(distDir, p));
    if (!file.startsWith(distDir)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file))
      return void res
        .writeHead(404, { 'Content-Type': 'text/html' })
        .end(await readFile(join(distDir, '404.html')));
    res
      .writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
      .end(await readFile(file));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, close: () => server.close() }),
    ),
  );
}
