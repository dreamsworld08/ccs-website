import { useEffect, useState } from 'preact/hooks';
import { call, deleteItem, listItems, saveItem, sitePath, type Item } from '../api';
import { LANDING_DEFAULTS, LANDING_FIELDS, validateFields } from '../schemas';
import { Banner, savedToast, toast } from '../ui';
import { ItemDrawer } from './ContentTab';
import type { Row } from './EnquiriesTab';

type Editing = { item: Item | null; data: Record<string, any>; adding: boolean };

export default function LandingPagesTab() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const [list, enq] = await Promise.all([
      listItems('landing-pages'),
      call<{ rows: Row[] }>('listEnquiries'),
    ]);
    if (list === null) return void setError('Could not load landing pages.');
    setItems(
      [...list].sort((a, b) =>
        String(a.data.internal_name).localeCompare(String(b.data.internal_name)),
      ),
    );
    if (enq.ok) {
      const c: Record<string, number> = {};
      for (const r of enq.rows)
        if (r.source.startsWith('lp:')) c[r.source.slice(3)] = (c[r.source.slice(3)] ?? 0) + 1;
      setCounts(c);
    }
  }
  useEffect(() => void load(), []);

  const linkFor = (slug: string) => `${location.origin}${sitePath(`/lp/${slug}/`)}`;
  async function copyLink(slug: string) {
    try {
      await navigator.clipboard.writeText(linkFor(slug));
      toast('Link copied.', 'info', 2500);
    } catch {
      window.prompt('Copy this link:', linkFor(slug));
    }
  }

  function fail(res: { error?: string; code?: string }) {
    if (res.code === 'conflict') {
      toast('Someone else changed this page. The latest version has been loaded.', 'error', 8000);
      void load();
    } else if (res.code !== 'auth') toast(res.error || 'Something went wrong.', 'error', 8000);
  }

  async function toggle(item: Item, key: 'published' | 'show_on_main_site') {
    const res = await saveItem(item.path, { ...item.data, [key]: !item.data[key] }, item.sha);
    if (res.ok) {
      savedToast(res.local);
      await load();
    } else fail(res);
  }

  async function remove(item: Item) {
    if (
      !window.confirm(
        `Delete the landing page “${item.data.internal_name}”? Its link will stop working and its enquiries stay in the sheet.`,
      )
    )
      return;
    const res = await deleteItem(item.path, item.sha);
    if (res.ok) {
      savedToast(res.local);
      await load();
    } else fail(res);
  }

  async function duplicate(item: Item) {
    const taken = new Set((items ?? []).map((i) => i.data.slug));
    let slug = window.prompt(
      'Address for the copy (lowercase letters, numbers and hyphens):',
      `${item.data.slug}-copy`,
    );
    if (!slug) return;
    slug = slug.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      return void toast('Use only lowercase letters, numbers and hyphens.', 'error');
    if (taken.has(slug)) return void toast('A page with that address already exists.', 'error');
    const data: Record<string, any> = {
      ...item.data,
      slug,
      internal_name: `${item.data.internal_name} (copy)`,
      published: false,
      show_on_main_site: false,
    };
    delete data.dummy;
    const res = await saveItem(`landing-pages/${slug}.json`, data, '');
    if (res.ok) {
      savedToast(res.local);
      await load();
    } else fail(res);
  }

  async function save() {
    if (!editing) return;
    const { data, adding, item } = editing;
    const problem = validateFields(LANDING_FIELDS, data, adding);
    if (problem) return void toast(problem, 'error', 6000);
    if (adding && (items ?? []).some((i) => i.data.slug === data.slug))
      return void toast('A page with that address already exists.', 'error');
    const clean: Record<string, any> = { ...data };
    delete clean.dummy;
    clean.hero_bullets = (clean.hero_bullets ?? [])
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    clean.faqs = (clean.faqs ?? []).filter((f: any) => f.q?.trim() && f.a?.trim()).slice(0, 8);
    clean.benefits = (clean.benefits ?? [])
      .filter((b: any) => b.title?.trim() || b.text?.trim())
      .slice(0, 3);
    setBusy(true);
    const res = await saveItem(
      adding ? `landing-pages/${clean.slug}.json` : item!.path,
      clean,
      adding ? '' : item!.sha,
    );
    setBusy(false);
    if (res.ok) {
      savedToast(res.local);
      setEditing(null);
      await load();
    } else if (res.code === 'conflict' && res.current && !adding) {
      setEditing({ item: res.current, adding: false, data: res.current.data });
      fail(res);
    } else fail(res);
  }

  return (
    <section>
      <div class="tab-head">
        <h1>Landing Pages</h1>
        <div class="tab-actions">
          <button
            class="btn btn-primary"
            onClick={() => setEditing({ item: null, adding: true, data: LANDING_DEFAULTS() })}
          >
            Add landing page
          </button>
        </div>
      </div>
      <p class="muted">
        All pages use one fixed template. Unpublished pages are not built at all: they disappear
        from the live site and the sitemap on the next build.
      </p>
      {error && (
        <Banner kind="error">
          {error}{' '}
          <button class="btn btn-sm" onClick={load}>
            Retry
          </button>
        </Banner>
      )}
      {!items && !error && <p class="muted">Loading…</p>}
      {items && items.length === 0 && <p class="empty">No landing pages yet.</p>}
      {items && items.length > 0 && (
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Internal name</th>
                <th>Published</th>
                <th>In footer</th>
                <th>Enquiries</th>
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.path} class={it.data.published ? '' : 'row-off'}>
                  <td class="mono">
                    /lp/{it.data.slug}/{it.data.dummy && <span class="badge">Sample</span>}
                  </td>
                  <td>{it.data.internal_name}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(it.data.published)}
                      onChange={() => toggle(it, 'published')}
                      aria-label={`Published: ${it.data.internal_name}`}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(it.data.show_on_main_site)}
                      onChange={() => toggle(it, 'show_on_main_site')}
                      aria-label={`Show in footer: ${it.data.internal_name}`}
                    />
                  </td>
                  <td class="mono">{counts[it.data.slug] ?? 0}</td>
                  <td class="col-actions">
                    <button
                      class="btn btn-sm"
                      onClick={() =>
                        setEditing({
                          item: it,
                          adding: false,
                          data: JSON.parse(JSON.stringify(it.data)),
                        })
                      }
                    >
                      Edit
                    </button>
                    <button class="btn btn-sm" onClick={() => duplicate(it)}>
                      Duplicate
                    </button>
                    <button class="btn btn-sm" onClick={() => copyLink(it.data.slug)}>
                      Copy link
                    </button>
                    {it.data.published && (
                      <a
                        class="btn btn-sm"
                        href={sitePath(`/lp/${it.data.slug}/`)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View
                      </a>
                    )}
                    <button class="btn btn-sm btn-danger" onClick={() => remove(it)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ItemDrawer
          title={
            editing.adding
              ? 'Add landing page'
              : `Edit: ${editing.data.internal_name || editing.data.slug}`
          }
          fields={LANDING_FIELDS}
          data={editing.data}
          ctx={{ adding: editing.adding }}
          busy={busy}
          onChange={(data) => setEditing({ ...editing, data })}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
