/**
 * Tiny progressive-enhancement filter used by Courses, Results, Free Resources and Exam Updates.
 * Everything is server-rendered; this only hides/shows items, so pages are complete without JS.
 *
 *   [data-list-filter]            root, optional data-page-size="12"
 *   [data-chip-group="field"]     wrapper of buttons [data-chip="value"] (empty value = All)
 *   select[data-filter-select="field"]   (empty value = All)
 *   input[data-search-input]      matches against each item's data-search (lowercase)
 *   [data-item]                   items; compared via data-<field> attributes
 *   [data-empty]  [data-more]  [data-count]
 *   data-accept-q on the root: honours ?q=... (used by site search) and shows [data-q-notice] with a
 *   [data-q-clear] button to show everything again.
 */
export function initListFilters() {
  document.querySelectorAll<HTMLElement>('[data-list-filter]').forEach(setup);
}

function setup(root: HTMLElement) {
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-item]'));
  const empty = root.querySelector<HTMLElement>('[data-empty]');
  const more = root.querySelector<HTMLButtonElement>('[data-more]');
  const count = root.querySelector<HTMLElement>('[data-count]');
  const search = root.querySelector<HTMLInputElement>('[data-search-input]');
  const pageSize = Number(root.dataset.pageSize || 0);
  const filters: Record<string, string> = {};
  const notice = root.querySelector<HTMLElement>('[data-q-notice]');
  let query = '';
  let shown = pageSize || Infinity;

  const apply = () => {
    let matched = 0;
    for (const item of items) {
      let ok = true;
      for (const [field, value] of Object.entries(filters)) {
        if (value && item.dataset[field] !== value) ok = false;
      }
      if (ok && query && !(item.dataset.search ?? '').includes(query)) ok = false;
      if (ok) matched++;
      item.hidden = !ok || matched > shown;
    }
    if (empty) empty.hidden = matched > 0;
    if (more) more.hidden = matched <= shown;
    if (count) count.textContent = `${matched} ${matched === 1 ? 'result' : 'results'}`;
  };

  root.querySelectorAll<HTMLElement>('[data-chip-group]').forEach((group) => {
    const field = group.dataset.chipGroup!;
    filters[field] = '';
    group.addEventListener('click', (e) => {
      const chip = (e.target as Element).closest<HTMLElement>('[data-chip]');
      if (!chip) return;
      filters[field] = chip.dataset.chip ?? '';
      group
        .querySelectorAll('[data-chip]')
        .forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      shown = pageSize || Infinity;
      apply();
    });
  });
  root.querySelectorAll<HTMLSelectElement>('[data-filter-select]').forEach((select) => {
    const field = select.dataset.filterSelect!;
    filters[field] = select.value;
    select.addEventListener('change', () => {
      filters[field] = select.value;
      shown = pageSize || Infinity;
      apply();
    });
  });
  search?.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    shown = pageSize || Infinity;
    apply();
  });
  more?.addEventListener('click', () => {
    shown += pageSize;
    apply();
  });
  // Deep link from site search: /results/?q=Aman%20Gill
  if (root.hasAttribute('data-accept-q')) {
    const q = new URLSearchParams(window.location.search).get('q')?.trim().toLowerCase() ?? '';
    if (q) {
      query = q;
      if (notice) {
        notice.hidden = false;
        const label = notice.querySelector<HTMLElement>('[data-q-text]');
        if (label) label.textContent = q;
        notice.querySelector('[data-q-clear]')?.addEventListener('click', () => {
          query = '';
          notice.hidden = true;
          history.replaceState(null, '', window.location.pathname);
          apply();
        });
      }
    }
  }
  apply();
}
