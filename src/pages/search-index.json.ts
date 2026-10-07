import type { APIRoute } from 'astro';
import { getExamUpdates, getResources, getResults, safeHref, withBase } from '../lib/site';
import { thumbFor } from '../lib/images';

/**
 * Build-time search index covering what students look for: free resources, exam updates and
 * results. Only PUBLISHED items are included, and the file is regenerated on every build, so an
 * unpublished item disappears from search together with the page itself. It is small enough to
 * download in one request the first time someone opens the search box (a few KB for hundreds of items).
 *
 *   t: type (r = resource, u = exam update, s = student result)   h: link   x: opens in a new tab
 *   w: lower-case searchable text, including friendly aliases ("pyq" also finds "previous year")
 */
const ALIASES: Record<string, string> = {
  // resource categories
  'Notes & PDFs': 'notes pdf study material download',
  PYQs: 'pyq pyqs previous year question papers',
  'Current Affairs': 'current affairs ca news monthly weekly',
  Videos: 'video watch youtube lecture',
  'Punjab GK': 'punjab gk general knowledge',
  // exam bodies
  UPSC: 'upsc union public service commission civil services cse ias',
  PPSC: 'ppsc punjab public service commission pcs',
  PSSSB: 'psssb subordinate services selection board punjab',
  'Punjab Police': 'punjab police constable si',
  // update categories
  Notification: 'notification notice advertisement vacancy',
  'Exam date': 'exam date schedule calendar',
  'Admit card': 'admit card hall ticket call letter',
  'Answer key': 'answer key solution',
  Result: 'result merit list cut off',
  Syllabus: 'syllabus pattern curriculum',
};
const alias = (k: string) => ALIASES[k] ?? '';

export const GET: APIRoute = async () => {
  const [resources, updates, results] = await Promise.all([
    getResources(),
    getExamUpdates(),
    getResults(),
  ]);
  const entries = [
    ...resources.map((r) => {
      const d = r.data;
      return {
        t: 'r',
        id: r.id,
        title: d.title,
        sub: d.subtitle,
        meta: d.category,
        kind: d.type,
        h: d.file ? withBase(d.file) : safeHref(d.url),
        x: true,
        w: `${d.title} ${d.subtitle} ${d.category} ${alias(d.category)} ${d.type}`,
      };
    }),
    ...updates.map((u) => {
      const d = u.data;
      return {
        t: 'u',
        id: u.id,
        title: d.title,
        sub: `${d.exam_body} · ${d.category}`,
        meta: d.date,
        h: safeHref(d.link),
        x: true,
        w: `${d.title} ${d.exam_body} ${alias(d.exam_body)} ${d.category} ${alias(d.category)} ${d.date}`,
      };
    }),
    ...(await Promise.all(
      results.map(async (r) => {
        const d = r.data;
        return {
          t: 's',
          id: r.id,
          title: d.student_name,
          sub: `${d.exam} · ${d.exam_year}`,
          meta: d.rank_label,
          img: await thumbFor(d.photo),
          h: `${withBase('/results/')}?q=${encodeURIComponent(d.student_name)}`,
          x: false,
          w: `${d.student_name} ${d.exam} ${d.exam_year} ${d.rank_label} topper selection rank result`,
        };
      }),
    )),
  ]
    // Anything without a usable destination is not worth showing.
    .filter((e) => e.h);

  return new Response(
    JSON.stringify(
      entries.map((e) => ({ ...e, w: e.w.toLowerCase().replace(/\s+/g, ' ').trim() })),
    ),
    {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
};
