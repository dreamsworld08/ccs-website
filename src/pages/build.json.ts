import type { APIRoute } from 'astro';

/**
 * Identifies this deployment. After saving content, /admin polls this file until the id
 * changes, which confirms the new build is live. GITHUB_SHA is set by GitHub Actions.
 */
export const GET: APIRoute = () => {
  const id = process.env.GITHUB_SHA?.slice(0, 12) || String(Date.now());
  return new Response(JSON.stringify({ id, builtAt: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
