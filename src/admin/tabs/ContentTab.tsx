import { useEffect, useMemo, useState } from 'preact/hooks';
import { FieldInput, type FieldCtx } from '../fields';
import {
  assetUrl,
  deleteItem,
  listItems,
  saveItem,
  shortId,
  sitePath,
  slugify,
  type Item,
} from '../api';
import { validateFields, type CollectionDef, type Field } from '../schemas';
import { Banner, Drawer, savedToast, toast } from '../ui';
import { fmtDate } from '../format';

type Editing = { item: Item | null; data: Record<string, any>; adding: boolean };

/** Extra, collection-specific rules on top of per-field validation. */
function extraValidation(def: CollectionDef, d: Record<string, any>): string {
  if (def.folder === 'reels') {
    const ok =
      /^https?:\/\/(www\.)?instagram\.com\/([A-Za-z0-9_.]+\/)?(reels?|p|tv)\/[A-Za-z0-9_-]{5,20}([/?#]|$)/i.test(
        String(d.instagram_url ?? '').trim(),
      );
    if (!ok)
      return 'Paste an Instagram reel link, for example https://www.instagram.com/reel/AbCdEfGh123/';
  }
  if (def.folder === 'resources') {
    const hasFile = Boolean(d.file);
    const hasUrl = Boolean(String(d.url ?? '').trim());
    if (d.type === 'pdf' && hasFile === hasUrl)
      return hasFile
        ? 'Use either an uploaded PDF or a link, not both.'
        : 'Upload a PDF or paste a link.';
    if (d.type !== 'pdf' && !hasUrl) return 'Paste the video / page link.';
  }
  return '';
}

export function sortItems(def: CollectionDef, items: Item[]): Item[] {
  const title = (i: Item) => String(i.data[def.titleKey] ?? '').toLowerCase();
  return [...items].sort((a, b) => {
    if (def.order)
      return (a.data.order ?? 999) - (b.data.order ?? 999) || title(a).localeCompare(title(b));
    if (def.folder === 'exam-updates')
      return String(b.data.date).localeCompare(String(a.data.date));
    return title(a).localeCompare(title(b));
  });
}

export default function ContentTab({
  def,
  courses,
}: {
  def: CollectionDef;
  courses?: { id: string; name: string }[];
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  async function load() {
    setError('');
    const list = await listItems(def.folder);
    if (list === null) setError('Could not load. Check your connection and try again.');
    else setItems(sortItems(def, list));
  }
  useEffect(() => {
    setItems(null);
    setEditing(null);
    void load();
  }, [def.folder]);

  const samples = useMemo(() => (items ?? []).filter((i) => i.data.dummy).length, [items]);

  function handleResult(
    res: { ok: boolean; error?: string; code?: string; local?: boolean },
    okMsg = true,
  ) {
    if (res.ok) {
      if (okMsg) savedToast(res.local);
      return true;
    }
    if (res.code === 'conflict') {
      setConflict(true);
      toast('Someone else changed this item. The latest version has been loaded.', 'error', 8000);
      void load();
    } else if (res.code !== 'auth')
      toast(res.error || 'Something went wrong. Please try again.', 'error', 8000);
    return false;
  }

  async function togglePublished(item: Item) {
    const data = { ...item.data, published: !item.data.published };
    const res = await saveItem(item.path, data, item.sha);
    if (handleResult(res)) await load();
  }

  async function move(item: Item, dir: -1 | 1) {
    if (!items) return;
    const idx = items.findIndex((i) => i.path === item.path);
    const to = idx + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[idx], next[to]] = [next[to], next[idx]];
    // Renumber 1..n; only files whose order actually changes are saved (normally two).
    const changed = next
      .map((it, i) => ({ it, order: i + 1 }))
      .filter((x) => x.it.data.order !== x.order);
    setBusy(true);
    let ok = true;
    for (const { it, order } of changed) {
      const res = await saveItem(it.path, { ...it.data, order }, it.sha);
      if (!handleResult(res, false)) {
        ok = false;
        break;
      }
    }
    setBusy(false);
    if (ok) savedToast();
    await load();
  }

  async function remove(item: Item) {
    const name = String(item.data[def.titleKey] || 'this item');
    if (!window.confirm(`Delete “${name}”? It will be removed from the website.`)) return;
    const res = await deleteItem(item.path, item.sha);
    if (handleResult(res)) await load();
  }

  function startAdd() {
    const max = Math.max(0, ...(items ?? []).map((i) => Number(i.data.order) || 0));
    setConflict(false);
    setEditing({
      item: null,
      adding: true,
      data: { ...def.defaults(), ...(def.order ? { order: max + 1 } : {}) },
    });
  }

  async function save() {
    if (!editing) return;
    const { data, adding, item } = editing;
    const problem = validateFields(def.fields, data, adding) || extraValidation(def, data);
    if (problem) return void toast(problem, 'error', 6000);
    const clean: Record<string, any> = { ...data };
    delete clean.dummy; // an edited sample entry is now real content
    if (def.folder === 'resources') {
      if (clean.type === 'pdf') clean.url = String(clean.url ?? '').trim() ? clean.url : '';
      else clean.file = '';
    }
    setBusy(true);
    const path = adding
      ? `${def.folder}/${slugify(String(clean[def.titleKey]))}-${shortId()}.json`
      : item!.path;
    const res = await saveItem(path, clean, adding ? '' : item!.sha);
    setBusy(false);
    if (res.ok) {
      savedToast(res.local);
      setEditing(null);
      await load();
    } else if (res.code === 'conflict') {
      setConflict(true);
      const cur = res.current;
      if (cur && !adding) setEditing({ item: cur, adding: false, data: cur.data });
      void load();
    } else if (res.code !== 'auth') toast(res.error || 'Could not save.', 'error', 8000);
  }

  const ctx: FieldCtx = { courses, adding: editing?.adding };

  return (
    <section>
      <div class="tab-head">
        <h1>{def.label}</h1>
        <div class="tab-actions">
          <a class="btn" href={sitePath(def.sitePath)} target="_blank" rel="noopener noreferrer">
            View on site
          </a>
          <button type="button" class="btn btn-primary" onClick={startAdd}>
            Add {def.singular}
          </button>
        </div>
      </div>
      {def.intro && <p class="muted">{def.intro}</p>}
      {samples > 0 && (
        <Banner kind="warn">
          {samples} {samples === 1 ? 'item is' : 'items are'} sample data (marked “Sample”). Edit or
          delete them before launch.
        </Banner>
      )}
      {conflict && (
        <Banner kind="error">
          Someone else edited this at the same time. The latest version has been loaded; please
          re-apply your change.
        </Banner>
      )}
      {error && (
        <Banner kind="error">
          {error}{' '}
          <button class="btn btn-sm" onClick={load}>
            Retry
          </button>
        </Banner>
      )}
      {!items && !error && <p class="muted">Loading…</p>}
      {items && items.length === 0 && (
        <p class="empty">
          No {def.label.toLowerCase()} yet. Click “Add {def.singular}”.
        </p>
      )}
      {items && items.length > 0 && (
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                {def.order && <th class="col-order">Order</th>}
                {def.columns.map((c) => (
                  <th>{c.label}</th>
                ))}
                {def.published && <th>Published</th>}
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.path} class={it.data.published === false ? 'row-off' : ''}>
                  {def.order && (
                    <td class="col-order">
                      <button
                        class="btn btn-sm btn-icon"
                        disabled={busy || idx === 0}
                        onClick={() => move(it, -1)}
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        class="btn btn-sm btn-icon"
                        disabled={busy || idx === items.length - 1}
                        onClick={() => move(it, 1)}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                    </td>
                  )}
                  {def.columns.map((c, ci) => (
                    <td class={c.kind === 'mono' ? 'mono' : ''}>
                      {c.kind === 'image' ? (
                        it.data[c.key] ? (
                          <img class="thumb" src={assetUrl(it.data[c.key])} alt="" loading="lazy" />
                        ) : (
                          <span class="muted">—</span>
                        )
                      ) : c.kind === 'bool' ? (
                        it.data[c.key] ? (
                          '✓'
                        ) : (
                          '–'
                        )
                      ) : c.kind === 'date' ? (
                        fmtDate(it.data[c.key])
                      ) : (
                        String(it.data[c.key] ?? '')
                      )}
                      {ci === 0 && it.data.dummy && <span class="badge">Sample</span>}
                    </td>
                  ))}
                  {def.published && (
                    <td>
                      <label class="inline-check">
                        <input
                          type="checkbox"
                          checked={it.data.published !== false}
                          disabled={busy}
                          onChange={() => togglePublished(it)}
                          aria-label={`Published: ${it.data[def.titleKey]}`}
                        />
                      </label>
                    </td>
                  )}
                  <td class="col-actions">
                    <button
                      class="btn btn-sm"
                      onClick={() => {
                        setConflict(false);
                        setEditing({ item: it, adding: false, data: { ...it.data } });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      class="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => remove(it)}
                    >
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
          title={editing.adding ? `Add ${def.singular}` : `Edit ${def.singular}`}
          fields={def.fields}
          data={editing.data}
          ctx={ctx}
          busy={busy}
          onChange={(data) => setEditing({ ...editing, data })}
          onSave={save}
          onClose={() => setEditing(null)}
          notice={
            conflict
              ? 'Someone else changed this item. The latest version is shown; re-apply your change.'
              : ''
          }
        />
      )}
    </section>
  );
}

export function ItemDrawer({
  title,
  fields,
  data,
  ctx,
  busy,
  onChange,
  onSave,
  onClose,
  notice,
}: {
  title: string;
  fields: Field[];
  data: Record<string, any>;
  ctx: FieldCtx;
  busy: boolean;
  onChange: (d: Record<string, any>) => void;
  onSave: () => void;
  onClose: () => void;
  notice?: string;
}) {
  return (
    <Drawer
      title={title}
      onClose={onClose}
      footer={
        <>
          <button class="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button class="btn btn-primary" type="button" disabled={busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {notice && <Banner kind="warn">{notice}</Banner>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        {fields.map((f) => (
          <FieldInput
            field={f}
            data={data}
            set={(k, v) => onChange({ ...data, [k]: v })}
            ctx={ctx}
            idPrefix="f"
          />
        ))}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
