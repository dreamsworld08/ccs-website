import { useEffect, useState } from 'preact/hooks';
import { call, getItem, loadSession, saveItem, saveSession, type Item } from '../api';
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
      <ChangePassword />
      <fieldset class="section">
        <legend>Who can sign in</legend>
        <p class="muted">
          The list of people who can sign in is fixed by your developer in the website&rsquo;s code,
          so nobody can be added or removed from here. To add someone, remove access, or if you
          forget your password, ask your developer.
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

/** Each admin chooses their own password. Everyone else who is signed in with the old one is signed out. */
function ChangePassword() {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (newPw !== again) return void toast('The two new passwords do not match.', 'error');
    setBusy(true);
    const res = await call<{ token: string; expires_in: number }>('changePassword', {
      old_password: oldPw,
      new_password: newPw,
    });
    setBusy(false);
    if (res.ok) {
      // This browser carries on with a fresh session; every other session is now signed out.
      const session = loadSession();
      if (session)
        saveSession({
          ...session,
          token: res.token,
          expiresAt: Date.now() + res.expires_in * 1000,
        });
      toast(
        'Password changed. Anyone else signed in with the old password has been signed out.',
        'ok',
        7000,
      );
      setOldPw('');
      setNewPw('');
      setAgain('');
    } else if (res.code !== 'auth')
      toast(res.error || 'Could not change the password.', 'error', 7000);
  }
  return (
    <fieldset class="section">
      <legend>Change my password</legend>
      <form class="inline-form" onSubmit={submit}>
        <label>
          Current password
          <input
            type="password"
            value={oldPw}
            required
            autocomplete="current-password"
            onInput={(e) => setOldPw((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPw}
            minLength={12}
            maxLength={100}
            required
            autocomplete="new-password"
            onInput={(e) => setNewPw((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          New password again
          <input
            type="password"
            value={again}
            minLength={12}
            maxLength={100}
            required
            autocomplete="new-password"
            onInput={(e) => setAgain((e.target as HTMLInputElement).value)}
          />
        </label>
        <button class="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
        <p class="help">
          At least 12 characters with a letter and a number, and not your login. Longer is better: a
          few random words work well. Use a password you do not use anywhere else.
        </p>
      </form>
    </fieldset>
  );
}
