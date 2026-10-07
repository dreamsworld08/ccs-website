import { useEffect, useRef, useState } from 'preact/hooks';
import { SUGGESTIONS } from '../lib/search';
import { iconSvg } from '../lib/icons';
import { comboKeys, ResultsListbox, SearchStatus, useSearchModel } from './search-ui';

const ID = 'nav-search';

/**
 * Search icon in the header. Before the script loads it is a plain link to /search/, so it works
 * without JavaScript. Once hydrated it opens a panel with live results for free resources,
 * exam updates and student results (an ARIA combobox: arrow keys, Enter, Esc).
 */
export default function NavSearch({ searchUrl }: { searchUrl: string }) {
  const m = useSearchModel();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  function openPanel() {
    // Close the mobile menu first so the two never stack.
    if (document.body.dataset.navOpen === 'true') document.getElementById('nav-toggle')?.click();
    setOpen(true);
    document.body.dataset.searchOpen = 'true';
    if (!m.entries) m.load();
    window.setTimeout(() => input.current?.focus(), 20);
  }
  function closePanel(returnFocus = true) {
    setOpen(false);
    m.setActive(-1);
    delete document.body.dataset.searchOpen;
    if (returnFocus) button.current?.focus();
  }

  // "/" opens search from anywhere (unless the user is typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openPanel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [m.entries]);

  // Click or tap outside closes the panel; Escape closes it from anywhere inside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) closePanel(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closePanel();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <>
      <a
        ref={button}
        href={searchUrl}
        class="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel text-ink hover:bg-line min-[360px]:inline-flex"
        aria-label="Search free resources, exam updates and results"
        aria-expanded={open}
        aria-controls="nav-search-panel"
        onClick={(e) => {
          e.preventDefault();
          if (open) closePanel();
          else openPanel();
        }}
        dangerouslySetInnerHTML={{ __html: iconSvg(open ? 'x' : 'search', 20) }}
      />
      {open && (
        <div
          id="nav-search-panel"
          ref={panel}
          class="absolute inset-x-0 top-full z-50 border-b border-line bg-white shadow-[0_24px_40px_-24px_rgb(26_27_31/0.35)]"
        >
          <div class="container-x py-4 md:py-5">
            <form role="search" action={searchUrl} method="get" class="relative">
              <label class="sr-only-x" for="nav-search-input">
                Search free resources, exam updates and results
              </label>
              <span
                class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
                dangerouslySetInnerHTML={{ __html: iconSvg('search', 20) }}
              />
              <input
                ref={input}
                id="nav-search-input"
                name="q"
                type="search"
                role="combobox"
                aria-expanded={m.optionCount > 0}
                aria-controls="nav-search-list"
                aria-autocomplete="list"
                aria-activedescendant={m.active >= 0 ? `${ID}-opt-${m.active}` : undefined}
                autocomplete="off"
                enterkeyhint="search"
                maxLength={80}
                class="input !min-h-[52px] !rounded-full !pl-12 !pr-4"
                placeholder="Search resources, exam updates, results…"
                value={m.q}
                onInput={(e) => {
                  m.setQ((e.target as HTMLInputElement).value);
                  m.setActive(-1);
                  if (m.failed) m.load();
                }}
                onKeyDown={(e) => comboKeys(e, m, ID)}
              />
            </form>

            <p class="sr-only-x" role="status" aria-live="polite">
              {m.hasQuery && m.entries ? `${m.count} ${m.count === 1 ? 'result' : 'results'}` : ''}
            </p>

            <div class="mt-3 max-h-[min(58dvh,26rem)] overflow-y-auto overscroll-contain">
              {!m.failed && !m.hasQuery && (
                <div class="px-1 py-2">
                  <p class="mono pb-2 text-[12px] uppercase tracking-wider text-muted">
                    Try searching for
                  </p>
                  <div class="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        type="button"
                        class="filter-chip"
                        onClick={() => {
                          m.setQ(s);
                          input.current?.focus();
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <SearchStatus m={m} searchUrl={searchUrl} />
              <ResultsListbox m={m} idPrefix={ID} onInternalNavigate={() => closePanel(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
