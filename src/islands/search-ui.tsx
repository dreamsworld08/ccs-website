import { useMemo, useState } from 'preact/hooks';
import { loadIndex, search, searchPageUrl, TYPE_LABEL, total, type Entry } from '../lib/search';
import { iconSvg } from '../lib/icons';

/**
 * Shared pieces of the site search, used by the header dropdown (NavSearch) and the hero search bar
 * (HeroSearch): the data model, keyboard handling and the grouped result list. Both are ARIA comboboxes.
 */

export const PER_TYPE = 3;
const ICON: Record<string, string> = {
  pdf: 'file-text',
  video: 'video',
  link: 'link',
  u: 'newspaper',
  s: 'trophy',
};
const iconFor = (e: Entry) => (e.t === 'r' ? ICON[e.kind ?? 'pdf'] : ICON[e.t]);

export function useSearchModel() {
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);

  const groups = useMemo(
    () => (entries ? search(entries, q) : { r: [], u: [], s: [] }),
    [entries, q],
  );
  const shown = useMemo(
    () => ({
      r: groups.r.slice(0, PER_TYPE),
      u: groups.u.slice(0, PER_TYPE),
      s: groups.s.slice(0, PER_TYPE),
    }),
    [groups],
  );
  const flat = useMemo(() => [...shown.r, ...shown.u, ...shown.s], [shown]);
  const count = total(groups);
  const hasQuery = q.trim().length > 0;
  // The last option is "see all results" whenever there is something to see.
  const optionCount = flat.length + (hasQuery && count > 0 ? 1 : 0);

  function load() {
    setFailed(false);
    loadIndex()
      .then(setEntries)
      .catch(() => setFailed(true));
  }

  return {
    q,
    setQ,
    entries,
    failed,
    active,
    setActive,
    groups,
    shown,
    flat,
    count,
    hasQuery,
    optionCount,
    load,
  };
}
export type SearchModel = ReturnType<typeof useSearchModel>;

/**
 * Arrow keys move through the options, Enter opens the highlighted one. Escape with text in the box
 * clears it; otherwise it is left to the caller (`onEscape`) to close the panel.
 */
export function comboKeys(
  e: KeyboardEvent,
  m: SearchModel,
  idPrefix: string,
  onEscape?: () => void,
) {
  if (e.key === 'Escape') {
    if (m.hasQuery) {
      e.preventDefault();
      m.setQ('');
    } else onEscape?.();
  } else if (e.key === 'ArrowDown' && m.optionCount) {
    e.preventDefault();
    m.setActive((a) => (a + 1) % m.optionCount);
  } else if (e.key === 'ArrowUp' && m.optionCount) {
    e.preventDefault();
    m.setActive((a) => (a <= 0 ? m.optionCount - 1 : a - 1));
  } else if (e.key === 'Enter' && m.active >= 0) {
    e.preventDefault();
    document.getElementById(`${idPrefix}-opt-${m.active}`)?.click();
  }
}

/** Loading / unavailable / empty messages that replace the list. */
export function SearchStatus({ m, searchUrl }: { m: SearchModel; searchUrl: string }) {
  if (m.failed) {
    return (
      <p class="px-3 py-4 text-[15px] text-muted" role="alert">
        Search is unavailable right now. Try the{' '}
        <a class="text-primary underline" href={searchUrl}>
          search page
        </a>{' '}
        or browse Free Resources, Exam Updates and Results from the menu.
      </p>
    );
  }
  if (m.hasQuery && !m.entries) return <p class="px-3 py-4 text-[15px] text-muted">Searching…</p>;
  if (m.hasQuery && m.entries && m.count === 0) {
    return (
      <p class="px-3 py-4 text-[15px] text-muted">
        No matches for “{m.q.trim()}”. Try a shorter word such as “patwari”, “pyq” or “admit card”.
      </p>
    );
  }
  return null;
}

/** Grouped result options (free resources, exam updates, results) plus the "see all" row. */
export function ResultsListbox({
  m,
  idPrefix,
  onInternalNavigate,
}: {
  m: SearchModel;
  idPrefix: string;
  /** Called when an option that stays on this site (a student result) is chosen. */
  onInternalNavigate?: () => void;
}) {
  if (m.optionCount === 0) return null;
  const rowCls = (i: number) =>
    `flex items-center gap-3 rounded-[14px] px-3 py-2.5 ${m.active === i ? 'bg-panel' : 'hover:bg-panel'}`;

  let idx = -1;
  const group = (type: 'r' | 'u' | 's') => {
    const items = m.shown[type];
    if (!items.length) return null;
    return (
      <li role="presentation" key={type}>
        <p
          class="mono px-3 pt-3 pb-1 text-[12px] uppercase tracking-wider text-muted"
          role="presentation"
        >
          {TYPE_LABEL[type]}
        </p>
        <ul role="presentation">
          {items.map((e) => {
            const i = ++idx;
            return (
              <li role="presentation" key={e.t + e.id}>
                <a
                  id={`${idPrefix}-opt-${i}`}
                  role="option"
                  aria-selected={m.active === i}
                  href={e.h}
                  target={e.x ? '_blank' : undefined}
                  rel={e.x ? 'noopener noreferrer' : undefined}
                  class={rowCls(i)}
                  onMouseEnter={() => m.setActive(i)}
                  onClick={() => !e.x && onInternalNavigate?.()}
                >
                  <span
                    class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel"
                    dangerouslySetInnerHTML={{ __html: iconSvg(iconFor(e), 18) }}
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[15px] font-medium">{e.title}</span>
                    <span class="block truncate text-[13px] text-muted">
                      {[e.sub, e.t === 's' ? e.meta : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {e.t === 's' && (
                    <span class="mono shrink-0 rounded-full bg-primary px-2.5 py-1 text-[12px] text-white">
                      {e.meta}
                    </span>
                  )}
                  <span
                    class="shrink-0 text-muted"
                    dangerouslySetInnerHTML={{
                      __html: iconSvg(e.x ? 'arrow-up-right' : 'arrow-right', 16),
                    }}
                  />
                </a>
              </li>
            );
          })}
        </ul>
      </li>
    );
  };

  return (
    <ul id={`${idPrefix}-list`} role="listbox" aria-label="Search results">
      {group('r')}
      {group('u')}
      {group('s')}
      {m.hasQuery && m.count > 0 && (
        <li role="presentation" class="mt-1 border-t border-line pt-2">
          <a
            id={`${idPrefix}-opt-${m.flat.length}`}
            role="option"
            aria-selected={m.active === m.flat.length}
            href={searchPageUrl(m.q.trim())}
            class={`${rowCls(m.flat.length)} font-medium text-primary`}
            onMouseEnter={() => m.setActive(m.flat.length)}
          >
            See all {m.count} {m.count === 1 ? 'result' : 'results'} for “{m.q.trim()}”
            <span
              class="ml-auto"
              dangerouslySetInnerHTML={{ __html: iconSvg('arrow-right', 16) }}
            />
          </a>
        </li>
      )}
    </ul>
  );
}
