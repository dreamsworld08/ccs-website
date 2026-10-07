import { useEffect, useState } from 'preact/hooks';
import { getItem, saveItem, type Item } from '../api';
import { FieldInput } from '../fields';
import { SETTINGS_FIELDS, validateFields } from '../schemas';
import { Banner, savedToast, toast } from '../ui';

const PATH = 'settings/site.json';

export default function SettingsTab({
  onSettings,
}: {
  onSettings: (s: Record<string, any>) => void;
}) {
  return (
    <section>
      <div class="tab-head">
        <h1>Settings</h1>
      </div>
      <SiteSettings onSettings={onSettings} />
      <fieldset class="section">
        <legend>Admin logins</legend>
        <p class="muted">
          The people who can sign in are fixed by your developer in the website&rsquo;s code, so
          they cannot be added, changed or removed from here. To add someone, change a password or
          remove access, ask your developer.
        </p>
      </fieldset>
    </section>
  );
}

function SiteSettings({ onSettings }: { onSettings: (s: Record<string, any>) => void }) {
  const [item, setItem] = useState<Item | null>(null);
  const [data, setData] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const res = await getItem(PATH);
    if (!res.ok) return void setError(res.error || 'Could not load settings.');
    setItem(res as unknown as Item);
    setData((res as unknown as Item).data);
    setDirty(false);
  }
  useEffect(() => void load(), []);

  async function save() {
    if (!item) return;
    const problem = validateFields(SETTINGS_FIELDS, data, false);
    if (problem) return void toast(problem, 'error', 6000);
    const clean = {
      ...data,
      attempt_years: (data.attempt_years ?? []).map((y: string) => y.trim()).filter(Boolean),
    };
    if (clean.attempt_years.length === 0)
      return void toast('Add at least one year of attempt.', 'error');
    setBusy(true);
    const res = await saveItem(PATH, clean, item.sha);
    setBusy(false);
    if (res.ok) {
      savedToast(res.local);
      setItem({ ...item, sha: res.sha ?? item.sha, data: clean });
      setData(clean);
      setDirty(false);
      onSettings(clean);
    } else if (res.code === 'conflict') {
      toast(
        'Someone else changed the settings. The latest version has been loaded.',
        'error',
        8000,
      );
      await load();
    } else if (res.code !== 'auth') toast(res.error || 'Could not save.', 'error', 8000);
  }

  return (
    <fieldset class="section">
      <legend>Site settings</legend>
      {error && <Banner kind="error">{error}</Banner>}
      {!item && !error && <p class="muted">Loading…</p>}
      {item && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {SETTINGS_FIELDS.map((f) => (
            <FieldInput
              field={f}
              data={data}
              set={(k, v) => {
                setData({ ...data, [k]: v });
                setDirty(true);
              }}
              ctx={{}}
              idPrefix="s"
            />
          ))}
          <button class="btn btn-primary" type="submit" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      )}
    </fieldset>
  );
}
