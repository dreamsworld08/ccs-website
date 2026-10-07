import { useEffect, useRef, useState } from 'preact/hooks';
import { SUGGESTIONS } from '../lib/search';
import { iconSvg } from '../lib/icons';
import { comboKeys, ResultsListbox, SearchStatus, useSearchModel } from './search-ui';

const ID = 'hero-search';

type Props = {
  searchUrl: string;
  placeholder: string;
  /** "Popular searches" chips shown when the box is empty (editable in the admin). */
  popular: string[];
};

/**
 * The search bar that sits on the bottom edge of the Home hero. Without JavaScript it is a normal
 * GET form to /search/. Once hydrated it shows live results for free resources, exam updates and
 * student results in a dropdown under the bar (an ARIA combobox: arrow keys, Enter, Esc).
 */
export default function HeroSearch({ searchUrl, placeholder, popular }: Props) {
  const m = useSearchModel();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const chips = popular.length ? popular : SUGGESTIONS;

  function openList() {
    if (open) return;
    setOpen(true);
    document.body.dataset.searchOpen = 'true';
    if (!m.entries) m.load();
    // On phones the keyboard covers the lower half of the screen: bring the bar to the top first
    // (native smooth scrolling) so the results below it stay visible.
    if (window.matchMedia('(max-width: 767px)').matches) {
      window.setTimeout(
        () => wrap.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
        60,
      );
    }
  }
  function closeList() {
    setOpen(false);
    m.setActive(-1);
    delete document.body.dataset.searchOpen;
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) closeList();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        closeList();
        input.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={wrap} class="relative mx-auto w-full max-w-[760px] scroll-mt-24">
      <form
        role="search"
        action={searchUrl}
        method="get"
        class="flex items-center gap-2 rounded-full bg-white p-1.5 pl-5 text-ink shadow-[0_24px_60px_-24px_rgb(26_27_31/0.6)] ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-primary md:p-2 md:pl-7"
      >
        <span
          class="shrink-0 text-muted"
          dangerouslySetInnerHTML={{ __html: iconSvg('search', 22) }}
        />
        <label class="sr-only-x" for="hero-search-input">
          Search free resources, exam updates and results
        </label>
        <input
          ref={input}
          id="hero-search-input"
          name="q"
          type="search"
          role="combobox"
          aria-expanded={open && m.optionCount > 0}
          aria-controls={`${ID}-list`}
          aria-autocomplete="list"
          aria-activedescendant={m.active >= 0 ? `${ID}-opt-${m.active}` : undefined}
          autocomplete="off"
          enterkeyhint="search"
          maxLength={80}
          class="h-12 min-w-0 flex-1 border-0 bg-transparent px-1 text-[16px] text-ink outline-none placeholder:text-[#7b8191] md:h-14 md:text-[18px] text-ellipsis"
          placeholder={placeholder}
          value={m.q}
          onFocus={openList}
          onInput={(e) => {
            openList();
            m.setQ((e.target as HTMLInputElement).value);
            m.setActive(-1);
            if (m.failed) m.load();
          }}
          onKeyDown={(e) => comboKeys(e, m, ID, closeList)}
        />
        <button
          type="submit"
          class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-white hover:bg-[#34363d] md:h-14 md:w-14"
          aria-label="Search"
          dangerouslySetInnerHTML={{ __html: iconSvg('search', 22) }}
        />
      </form>

      <p class="sr-only-x" role="status" aria-live="polite">
        {m.hasQuery && m.entries ? `${m.count} ${m.count === 1 ? 'result' : 'results'}` : ''}
      </p>

      {open && (
        <div class="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(60dvh,28rem)] overflow-y-auto overscroll-contain rounded-[24px] border border-line bg-white p-2 text-ink shadow-[0_30px_60px_-30px_rgb(26_27_31/0.5)]">
          {!m.failed && !m.hasQuery && (
            <div class="px-2 py-2">
              <p class="mono pb-2 text-[12px] uppercase tracking-wider text-muted">
                Popular searches
              </p>
              <div class="flex flex-wrap gap-2">
                {chips.map((s) => (
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
          <ResultsListbox m={m} idPrefix={ID} onInternalNavigate={closeList} />
        </div>
      )}
    </div>
  );
}
