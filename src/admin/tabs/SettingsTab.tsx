import { useEffect, useState } from 'preact/hooks';
import { call, getItem, saveItem, type Item } from '../api';
import { FieldInput } from '../fields';
import { SETTINGS_FIELDS, validateFields } from '../schemas';
import { Banner, savedToast, toast } from '../ui';

const PATH = 'settings/site.json';
type Admin = { email: string; name: string; active: boolean };

export default function SettingsTab({
  me,
  onSettings,
}: {
  me: { email: string };
  onSettings: (s: Record<string, any>) => void;
}) {
  return (
    <section>
      <div class="tab-head">
        <h1>Settings</h1>
      </div>
      <SiteSettings onSettings={onSettings} />
      <Admins me={me} />
      <ChangePassword />
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

function Admins({ me }: { me: { email: string } }) {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await call<{ admins: Admin[] }>('listAdmins');
    if (res.ok) setAdmins(res.admins);
  }
  useEffect(() => void load(), []);

  async function add(e: Event) {
    e.preventDefault();
    setBusy(true);
    const res = await call('addAdmin', { email, name, password });
    setBusy(false);
    if (res.ok) {
      toast(
        `Admin “${name}” added. Share the temporary password privately; they will be asked to choose their own at first login.`,
        'ok',
        9000,
      );
      setEmail('');
      setName('');
      setPassword('');
      await load();
    } else if (res.code !== 'auth') toast(res.error || 'Could not add the admin.', 'error', 7000);
  }
  async function setActive(a: Admin, active: boolean) {
    if (
      !active &&
      !window.confirm(`Deactivate ${a.name}? They will be logged out and unable to sign in.`)
    )
      return;
    const res = await call('setAdminActive', { email: a.email, active });
    if (res.ok) await load();
    else if (res.code !== 'auth') toast(res.error || 'Could not update the admin.', 'error', 7000);
  }
  async function reset(a: Admin) {
    const pw = window.prompt(
      `New password for ${a.name} (at least 8 characters, with a letter and a number):`,
    );
    if (!pw) return;
    const res = await call('resetAdminPassword', { email: a.email, password: pw });
    if (res.ok) toast(`Password reset for ${a.name}.`, 'ok');
    else if (res.code !== 'auth')
      toast(res.error || 'Could not reset the password.', 'error', 7000);
  }

  return (
    <fieldset class="section">
      <legend>Admins</legend>
      {!admins ? (
        <p class="muted">Loading…</p>
      ) : (
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Login</th>
                <th>Status</th>
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.email} class={a.active ? '' : 'row-off'}>
                  <td>
                    {a.name}
                    {a.email === me.email && <span class="badge">You</span>}
                  </td>
                  <td class="mono">{a.email}</td>
                  <td>{a.active ? 'Active' : 'Deactivated'}</td>
                  <td class="col-actions">
                    <button class="btn btn-sm" onClick={() => reset(a)}>
                      Reset password
                    </button>
                    {a.active ? (
                      <button
                        class="btn btn-sm btn-danger"
                        disabled={a.email === me.email}
                        title={a.email === me.email ? 'You cannot deactivate yourself' : ''}
                        onClick={() => setActive(a, false)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button class="btn btn-sm" onClick={() => setActive(a, true)}>
                        Activate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form class="inline-form" onSubmit={add}>
        <h3>Add an admin</h3>
        <label>
          Name
          <input
            value={name}
            maxLength={60}
            required
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Login (email or username)
          <input
            value={email}
            maxLength={120}
            required
            autocomplete="off"
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Temporary password
          <input
            type="password"
            value={password}
            minLength={8}
            maxLength={100}
            required
            autocomplete="new-password"
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </label>
        <button class="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add admin'}
        </button>
      </form>
    </fieldset>
  );
}

function ChangePassword() {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (newPw !== again) return void toast('The two new passwords do not match.', 'error');
    setBusy(true);
    const res = await call('changePassword', { old_password: oldPw, new_password: newPw });
    setBusy(false);
    if (res.ok) {
      toast('Password changed.', 'ok');
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
            minLength={8}
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
            minLength={8}
            maxLength={100}
            required
            autocomplete="new-password"
            onInput={(e) => setAgain((e.target as HTMLInputElement).value)}
          />
        </label>
        <button class="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
        <p class="help">At least 8 characters with a letter and a number.</p>
      </form>
    </fieldset>
  );
}
