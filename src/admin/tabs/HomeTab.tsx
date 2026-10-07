import { useEffect, useState } from 'preact/hooks';
import { getItem, listItems, saveItem, type Item } from '../api';
import { FieldInput } from '../fields';
import { HOME_SECTIONS, validateFields } from '../schemas';
import { Banner, savedToast, toast } from '../ui';

const PATH = 'home/home.json';

export default function HomeTab() {
  const [item, setItem] = useState<Item | null>(null);
  const [data, setData] = useState<Record<string, any>>({});
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setError('');
    const [res, list] = await Promise.all([getItem(PATH), listItems('courses')]);
    if (!res.ok) return void setError(res.error || 'Could not load the Home page content.');
    setItem(res as unknown as Item);
    setData((res as unknown as Item).data);
    setDirty(false);
    setCourses(
      (list ?? []).map((i) => ({
        id: i.path.replace(/^courses\//, '').replace(/\.json$/, ''),
        name: String(i.data.name),
      })),
    );
  }
  useEffect(() => void load(), []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    if (!item) return;
    const fields = HOME_SECTIONS.flatMap((s) => s.fields);
    const problem = validateFields(fields, data, false);
    if (problem) return void toast(problem, 'error', 6000);
    setBusy(true);
    const res = await saveItem(PATH, data, item.sha);
    setBusy(false);
    if (res.ok) {
      savedToast(res.local);
      setItem({ ...item, sha: res.sha ?? item.sha, data });
      setDirty(false);
    } else if (res.code === 'conflict') {
      toast(
        'Someone else changed the Home page. The latest version has been loaded; please re-apply your edit.',
        'error',
        9000,
      );
      await load();
    } else if (res.code !== 'auth') toast(res.error || 'Could not save.', 'error', 8000);
  }

  return (
    <section>
      <div class="tab-head">
        <h1>Home Page</h1>
        <div class="tab-actions">
          <a
            class="btn"
            href={`${(document.documentElement.dataset.base ?? '').replace(/\/$/, '')}/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on site
          </a>
          <button class="btn btn-primary" disabled={busy || !item || !dirty} onClick={save}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      <Banner kind="info">Layout is fixed. Only text, images and video can be changed.</Banner>
      {error && (
        <Banner kind="error">
          {error}{' '}
          <button class="btn btn-sm" onClick={load}>
            Retry
          </button>
        </Banner>
      )}
      {!item && !error && <p class="muted">Loading…</p>}
      {item && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {HOME_SECTIONS.map((section) => (
            <fieldset class="section" key={section.title}>
              <legend>{section.title}</legend>
              {section.note && <p class="help">{section.note}</p>}
              {section.fields.map((f) => (
                <FieldInput
                  field={f}
                  data={data}
                  set={(k, v) => {
                    setData({ ...data, [k]: v });
                    setDirty(true);
                  }}
                  ctx={{ courses }}
                  idPrefix="h"
                />
              ))}
            </fieldset>
          ))}
          <div class="sticky-save">
            {dirty && <span class="muted">Unsaved changes</span>}
            <button class="btn btn-primary" type="submit" disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
