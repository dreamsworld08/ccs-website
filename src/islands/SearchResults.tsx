import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  formatDay,
  loadIndex,
  search,
  SUGGESTIONS,
  TYPE_LABEL,
  total,
  type Entry,
} from '../lib/search';
import { iconSvg } from '../lib/icons';

type Tab = 'all' | 'r' | 'u' | 's';
const TONES: Record<string, string> = {
  'Notes & PDFs': 'bg-mint',
  PYQs: 'bg-lavender',
  'Current Affairs': 'bg-sky',
  Videos: 'bg-peach',
  'Punjab GK': 'bg-sand',
};

/** The /search/ page: same index as the header dropdown, with full cards, tabs and shareable ?q= links. */
export default function SearchResults({ initialQuery = '' }: { initialQuery?: string }) {
  const [q, setQ] = useState(
    () => new URLSearchParams(window.location.search).get('q') ?? initialQuery,
  );
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [debounced, setDebounced] = useState(q);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadIndex()
      .then(setEntries)
      .catch(() => setFailed(true));
    input.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(q);
      const url = new URL(window.location.href);
      if (q.trim()) url.searchParams.set('q', q.trim());
      else url.searchParams.delete('q');
      window.history.replaceState(null, '', url);
    }, 150);
    return () => window.clearTimeout(t);
  }, [q]);

  const groups = useMemo(
    () => (entries ? search(entries, debounced) : { r: [], u: [], s: [] }),
    [entries, debounced],
  );
  const count = total(groups);
  const hasQuery = debounced.trim().length > 0;
  const types: ('r' | 'u' | 's')[] = tab === 'all' ? ['r', 'u', 's'] : [tab];

  return (
    <div>
      <form
        role="search"
        class="relative mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          setDebounced(q);
        }}
      >
        <label class="sr-only-x" for="search-page-input">
          Search free resources, exam updates and results
        </label>
        <span
          class="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted"
          dangerouslySetInnerHTML={{ __html: iconSvg('search', 22) }}
        />
        <input
          ref={input}
          id="search-page-input"
          type="search"
          class="input !min-h-[60px] !rounded-full !pl-14 !text-[18px]"
          placeholder="Search free resources, exam updates and results"
          autocomplete="off"
          enterkeyhint="search"
          maxLength={80}
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </form>

      {failed && (
        <p class="rounded-[20px] bg-peach p-5" role="alert">
          Search is unavailable right now. You can browse{' '}
          <a class="underline" href="../free-resources/">
            Free Resources
          </a>
          ,{' '}
          <a class="underline" href="../exam-updates/">
            Exam Updates
          </a>{' '}
          and{' '}
          <a class="underline" href="../results/">
            Results
          </a>{' '}
          instead.
        </p>
      )}

      {!failed && !hasQuery && (
        <div>
          <p class="mono mb-3 text-[12px] uppercase tracking-wider text-muted">Try searching for</p>
          <div class="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button type="button" class="filter-chip" onClick={() => setQ(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {!failed && hasQuery && !entries && <p class="text-muted">Searching…</p>}

      {!failed && hasQuery && entries && (
        <>
          <p class="mb-5 text-muted" role="status" aria-live="polite">
            {count === 0
              ? `No matches for “${debounced.trim()}”.`
              : `${count} ${count === 1 ? 'result' : 'results'} for “${debounced.trim()}”`}
          </p>
          {count === 0 && (
            <p class="text-muted">
              Try a shorter word such as “patwari”, “pyq” or “admit card”, or check the spelling of
              the student’s name.
            </p>
          )}
          {count > 0 && (
            <div class="mb-8 flex flex-wrap gap-2" role="group" aria-label="Filter results by type">
              <button
                type="button"
                class="filter-chip"
                aria-pressed={tab === 'all'}
                onClick={() => setTab('all')}
              >
                All ({count})
              </button>
              {(['r', 'u', 's'] as const).map((t) =>
                groups[t].length ? (
                  <button
                    type="button"
                    class="filter-chip"
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {TYPE_LABEL[t]} ({groups[t].length})
                  </button>
                ) : null,
              )}
            </div>
          )}

          {types.map((t) =>
            groups[t].length ? (
              <section class="mb-12" key={t} aria-labelledby={`sr-${t}`}>
                <h2 id={`sr-${t}`} class="h3 mb-5 !text-[26px]">
                  {TYPE_LABEL[t]}
                </h2>
                {t === 'r' && (
                  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {groups.r.map((e) => (
                      <article
                        class={`flex flex-col rounded-[18px] p-4 md:rounded-[28px] md:p-6 ${TONES[e.meta] ?? 'bg-panel'}`}
                        key={e.id}
                      >
                        <span class="chip chip-line mb-3 self-start !bg-white/60 md:mb-5">
                          {e.meta}
                        </span>
                        <h3 class="h3 mb-1 !text-[18px] md:mb-2 md:!text-[24px]">{e.title}</h3>
                        {e.sub && <p class="text-[15px] text-muted">{e.sub}</p>}
                        <a
                          class="btn btn-dark btn-sm mt-4 self-start md:mt-6"
                          href={e.h}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {e.kind === 'video' ? 'Watch' : e.kind === 'link' ? 'Open' : 'Download'}
                          <span
                            dangerouslySetInnerHTML={{
                              __html: iconSvg(
                                e.kind === 'video'
                                  ? 'play'
                                  : e.kind === 'link'
                                    ? 'external-link'
                                    : 'download',
                                16,
                              ),
                            }}
                          />
                        </a>
                      </article>
                    ))}
                  </div>
                )}
                {t === 'u' && (
                  <ul class="border-t border-line">
                    {groups.u.map((e) => (
                      <li
                        class="grid items-center gap-x-4 gap-y-3 border-b border-line py-5 sm:grid-cols-[110px_1fr_auto]"
                        key={e.id}
                      >
                        <p class="mono text-[13px] text-muted">{formatDay(e.meta)}</p>
                        <div class="min-w-0">
                          <span class="chip mb-2">{e.sub}</span>
                          <p class="text-[17px] font-medium leading-snug">{e.title}</p>
                        </div>
                        <a
                          class="btn btn-secondary btn-sm justify-self-start sm:justify-self-end"
                          href={e.h}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Official link{' '}
                          <span
                            dangerouslySetInnerHTML={{ __html: iconSvg('arrow-up-right', 15) }}
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {t === 's' && (
                  <div class="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
                    {groups.s.map((e) => (
                      <a
                        class="card block h-full transition-colors hover:border-ink"
                        href={e.h}
                        key={e.id}
                      >
                        <div class="p-2 pb-0">
                          <div class="relative aspect-square overflow-hidden rounded-[14px] bg-panel md:aspect-[4/5] md:rounded-[20px]">
                            {e.img && (
                              <img
                                src={e.img}
                                alt=""
                                width="600"
                                height="750"
                                loading="lazy"
                                decoding="async"
                                class="absolute inset-0 h-full w-full object-cover"
                              />
                            )}
                            <span class="mono absolute left-3 top-3 rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white">
                              {e.meta}
                            </span>
                          </div>
                        </div>
                        <div class="p-5">
                          <h3 class="h3">{e.title}</h3>
                          <p class="mono mt-2 text-[13px] uppercase tracking-wide text-muted">
                            {e.sub}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            ) : null,
          )}
        </>
      )}
    </div>
  );
}
