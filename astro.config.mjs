import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import optimizeUploads from './scripts/lib/optimize-uploads.mjs';

// `site` and `base` come from the environment so the same code serves
// github.io (SITE_URL=https://<user>.github.io, BASE_PATH=/ccs-website/)
// and the client's own domain (SITE_URL=https://<domain>, BASE_PATH=/).
const site = process.env.SITE_URL || 'http://localhost:4321';
const base = process.env.BASE_PATH || '/';

// Origins the browser may send enquiry / admin requests to. Google Apps Script answers from
// script.google.com and redirects to script.googleusercontent.com. A local build (npm run
// build:local) also allows the dev backend.
const connectSrc = ["'self'", 'https://script.google.com', 'https://script.googleusercontent.com'];
if (process.env.PUBLIC_BACKEND_URL) connectSrc.push(new URL(process.env.PUBLIC_BACKEND_URL).origin);

export default defineConfig({
  site,
  base,
  output: 'static',
  build: { format: 'directory' },
  trailingSlash: 'always',
  security: {
    // GitHub Pages cannot send headers, so the policy ships as a <meta> tag. Astro adds sha256
    // hashes for its own inline scripts/styles; anything else inline is blocked.
    csp: {
      directives: [
        "default-src 'self'",
        // i.ytimg.com: video thumbnails. The Instagram hosts: pictures in the live Instagram feed.
        "img-src 'self' data: https://i.ytimg.com https://*.cdninstagram.com https://*.fbcdn.net",
        "media-src 'self' https:",
        `connect-src ${connectSrc.join(' ')}`,
        'frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.instagram.com',
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
  integrations: [
    preact(),
    // Writes responsive WebP + AVIF copies of every uploaded picture into dist/ after the build.
    optimizeUploads(),
    sitemap({
      // Unpublished landing pages are never built, so they never reach the sitemap.
      filter: (page) => !/\/(admin|search)(\/|$)/.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
