/** Client-side search over /search-index.json (built from published content only). */

export type Entry = {
  t: 'r' | 'u' | 's';
  id: string;
  title: string;
  sub: string;
  meta: string;
  kind?: string;
  img?: string;
  h: string;
  x: boolean;
  w: string;
};
export type Groups = { r: Entry[]; u: Entry[]; s: Entry[] };

export const TYPE_LABEL: Record<Entry['t'], string> = {
  r: 'Free resources',
  u: 'Exam updates',
  s: 'Results',
};

let cache: Promise<Entry[]> | null = null;

export function indexUrl(): string {
  const base = (document.documentElement.dataset.base ?? '').replace(/\/$/, '');
  return `${base}/search-index.json`;
}
export function searchPageUrl(q = ''): string {
  const base = (document.documentElement.dataset.base ?? '').replace(/\/$/, '');
  return `${base}/search/${q ? `?q=${encodeURIComponent(q)}` : ''}`;
}

/** Downloaded once, then reused by the dropdown and the search page. */
export function loadIndex(): Promise<Entry[]> {
  cache ??= fetch(indexUrl(), { credentials: 'omit' })
    .then((r) => {
      if (!r.ok) throw new Error(`index ${r.status}`);
      return r.json() as Promise<Entry[]>;
    })
    .catch((err) => {
      cache = null; // allow a retry on the next keystroke / open
      throw err;
    });
  return cache;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Every typed word must match the start of a word in the item (or, for words of 3+ letters, appear
 * inside one). Title matches rank above matches in the aliases and metadata.
 */
export function search(entries: Entry[], query: string): Groups {
  const tokens = norm(query).split(' ').filter(Boolean);
  const out: Groups = { r: [], u: [], s: [] };
  if (!tokens.length) return out;
  const scored: { e: Entry; score: number }[] = [];
  for (const e of entries) {
    const title = ` ${norm(e.title)} `;
    const text = ` ${norm(e.w)} `;
    let score = 0;
    let all = true;
    for (const tok of tokens) {
      if (title.includes(` ${tok}`)) score += 6;
      else if (text.includes(` ${tok}`)) score += 3;
      else if (tok.length >= 3 && (title.includes(tok) || text.includes(tok))) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ e, score: score + (title.trim().startsWith(tokens[0]) ? 2 : 0) });
  }
  // Higher score first; exam updates newest first among equals.
  scored.sort(
    (a, b) => b.score - a.score || (a.e.t === 'u' ? b.e.meta.localeCompare(a.e.meta) : 0),
  );
  for (const { e } of scored) out[e.t].push(e);
  return out;
}

export const total = (g: Groups) => g.r.length + g.u.length + g.s.length;

export const SUGGESTIONS = [
  'Patwari',
  'PYQ',
  'Admit card',
  'Current affairs',
  'Punjab GK',
  'AIR 7',
];

export function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
