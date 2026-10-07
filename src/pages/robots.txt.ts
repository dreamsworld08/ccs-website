import type { APIRoute } from 'astro';
import { BASE } from '../lib/site';

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('http://localhost:4321')).toString().replace(/\/$/, '');
  const body = [
    'User-agent: *',
    'Allow: /',
    `Disallow: ${BASE}/admin/`,
    '',
    `Sitemap: ${origin}${BASE}/sitemap-index.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
