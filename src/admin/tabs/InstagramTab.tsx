import { useEffect, useState } from 'preact/hooks';
import { assetUrl, call } from '../api';
import { Banner, fmtIst, toast } from '../ui';

type Post = { kind: string; code: string; video: boolean; image: string; caption: string };
type Status = {
  connected: boolean;
  username: string;
  account_type: string;
  enabled: boolean;
  count: number;
  heading: string;
  days_left: number | null;
  expiry_estimated: boolean;
  last_ok: string;
  last_error: string;
  posts: Post[];
};

/**
 * Instagram live feed. Unlike the other tabs this does not edit files in GitHub: the access token and the
 * display settings live in the backend, so a change is live straight away (no 2-minute rebuild) and the token
 * is never sent back to this page.
 */
export default function InstagramTab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const res = await call<Status>('getInstagram');
    if (res.ok) setStatus(res as unknown as Status);
    else if (res.code !== 'auth') setError(res.error || 'Could not load the Instagram settings.');
  }
  useEffect(() => void load(), []);

  return (
    <section>
      <div class="tab-head">
        <h1>Instagram</h1>
        <div class="tab-actions">
          <a
            class="btn"
            href={`${(document.documentElement.dataset.base ?? '').replace(/\/$/, '')}/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on site
          </a>
        </div>
      </div>
      <Banner kind="info">
        Show your latest Instagram posts on the Home page. Changes here are live straight away; new
        posts you publish on Instagram appear within about 15 minutes.
      </Banner>
      {error && (
        <Banner kind="error">
          {error}{' '}
          <button class="btn btn-sm" onClick={load}>
            Retry
          </button>
        </Banner>
      )}
      {!status && !error && <p class="muted">Loading…</p>}
      {status && !status.connected && <Connect onDone={setStatus} />}
      {status?.connected && <Connected status={status} onChange={setStatus} />}
    </section>
  );
}

function Connect({ onDone, replacing }: { onDone: (s: Status) => void; replacing?: boolean }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    const res = await call<Status>('connectInstagram', { access_token: token });
    setBusy(false);
    if (res.ok) {
      setToken('');
      onDone(res as unknown as Status);
      toast(
        replacing
          ? 'New access token saved.'
          : 'Instagram connected. Your posts are on the Home page.',
        'ok',
        7000,
      );
    } else if (res.code !== 'auth') toast(res.error || 'Could not connect.', 'error', 9000);
  }

  return (
    <fieldset class="section">
      <legend>{replacing ? 'Replace the access token' : 'Connect your Instagram account'}</legend>
      <details class="ig-steps" open={!replacing}>
        <summary>How to get the access token (one time, about 10 minutes)</summary>
        <ol>
          <li>
            The Instagram account must be a <strong>Professional</strong> account (Business or
            Creator). In the Instagram app: Settings, Account type and tools, Switch to professional
            account. A personal account cannot be connected.
          </li>
          <li>
            Open <strong>developers.facebook.com</strong>, sign in, and create an app. Add the{' '}
            <strong>Instagram</strong> product and choose “API setup with Instagram login”.
          </li>
          <li>
            Under “Generate access tokens”, add your Instagram account (sign in as the institute),
            then press <strong>Generate token</strong> and copy it. It is a long piece of text.
          </li>
          <li>Paste it below and press Connect.</li>
        </ol>
        <p class="help">
          Meta changes these screens from time to time. If a step looks different, ask your web
          developer: the token must be a long-lived “Instagram API with Instagram login” token. The
          connection renews itself while the website is visited, so you only do this once.
        </p>
      </details>
      <form class="inline-form" onSubmit={submit}>
        <label>
          Access token
          <input
            type="password"
            value={token}
            autocomplete="off"
            spellcheck={false}
            required
            onInput={(e) => setToken((e.target as HTMLInputElement).value)}
          />
        </label>
        <p class="help">
          The token is stored only on the server. It is never shown again, not even to admins.
        </p>
        <button class="btn btn-primary" type="submit" disabled={busy || !token.trim()}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </fieldset>
  );
}

function Connected({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [count, setCount] = useState(status.count);
  const [heading, setHeading] = useState(status.heading);
  const [busy, setBusy] = useState('');
  const [replace, setReplace] = useState(false);
  const dirty =
    enabled !== status.enabled || count !== status.count || heading.trim() !== status.heading;

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(e: Event) {
    e.preventDefault();
    setBusy('save');
    const res = await call<Status>('saveInstagramSettings', { enabled, count, heading });
    setBusy('');
    if (res.ok) {
      const next = res as unknown as Status;
      onChange(next);
      setHeading(next.heading);
      toast(
        next.enabled
          ? 'Saved. The Home page shows your Instagram posts now.'
          : 'Saved. The Instagram section is hidden on the Home page.',
        'ok',
      );
    } else if (res.code !== 'auth') toast(res.error || 'Could not save.', 'error', 8000);
  }

  async function refresh() {
    setBusy('refresh');
    const res = await call<Status>('refreshInstagram');
    setBusy('');
    if (res.ok) {
      onChange(res as unknown as Status);
      toast(
        (res as unknown as Status).last_error ? 'Instagram reported a problem.' : 'Posts reloaded.',
        (res as unknown as Status).last_error ? 'error' : 'ok',
      );
    } else if (res.code !== 'auth') toast(res.error || 'Could not refresh.', 'error', 8000);
  }

  async function disconnect() {
    if (
      !window.confirm(
        'Disconnect Instagram? The posts disappear from the Home page and the access token is deleted from the server.',
      )
    )
      return;
    setBusy('disconnect');
    const res = await call('disconnectInstagram');
    setBusy('');
    if (res.ok) {
      const fresh = await call<Status>('getInstagram');
      if (fresh.ok) onChange(fresh as unknown as Status);
      toast('Instagram disconnected.', 'ok');
    } else if (res.code !== 'auth') toast(res.error || 'Could not disconnect.', 'error', 8000);
  }

  const expiring = status.days_left !== null && status.days_left < 15;

  return (
    <>
      <fieldset class="section">
        <legend>Connection</legend>
        <p class="ig-account">
          Connected as <strong>@{status.username || 'your account'}</strong>
          {status.account_type && (
            <span class="badge ig-badge">{status.account_type.toLowerCase()}</span>
          )}
        </p>
        <p class="help">
          {status.last_ok ? `Last updated from Instagram: ${fmtIst(status.last_ok)}. ` : ''}
          {status.days_left !== null &&
            `The connection is good for ${status.expiry_estimated ? 'about ' : ''}${status.days_left} more days and renews itself while the website is visited.`}
        </p>
        {status.last_error && (
          <Banner kind="error">
            {status.last_error}{' '}
            {status.posts.length > 0 && 'The most recent posts we already have are still shown.'}
          </Banner>
        )}
        {expiring && !status.last_error && (
          <Banner kind="warn">
            This connection is close to expiring. Visits to the website renew it automatically; if
            this message stays, replace the access token below.
          </Banner>
        )}
        <div class="ig-actions">
          <button class="btn" onClick={refresh} disabled={busy !== ''}>
            {busy === 'refresh' ? 'Reloading…' : 'Refresh now'}
          </button>
          <button class="btn" onClick={() => setReplace(!replace)}>
            {replace ? 'Cancel' : 'Replace access token'}
          </button>
          <button class="btn btn-danger" onClick={disconnect} disabled={busy !== ''}>
            Disconnect
          </button>
        </div>
      </fieldset>

      {replace && (
        <Connect
          replacing
          onDone={(s) => {
            onChange(s);
            setReplace(false);
          }}
        />
      )}

      <form onSubmit={save}>
        <fieldset class="section">
          <legend>On the Home page</legend>
          <div class="field field-check">
            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
              />
              Show my latest Instagram posts on the Home page
            </label>
          </div>
          <div class="field">
            <label for="ig-heading">
              Section heading
              <span class={`counter ${heading.length > 55 ? 'counter-warn' : ''}`}>
                {heading.length}/60
              </span>
            </label>
            <input
              id="ig-heading"
              type="text"
              value={heading}
              maxLength={60}
              onInput={(e) => setHeading((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label for="ig-count">Number of posts to show</label>
            <select
              id="ig-count"
              value={count}
              onChange={(e) => setCount(Number((e.target as HTMLSelectElement).value))}
            >
              {Array.from({ length: 10 }, (_, i) => i + 3).map((n) => (
                <option value={n} key={n}>
                  {n}
                </option>
              ))}
            </select>
            <p class="help">Photos and reels both appear, newest first.</p>
          </div>
          <button class="btn btn-primary" type="submit" disabled={busy !== '' || !dirty}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </fieldset>
      </form>

      <fieldset class="section">
        <legend>What visitors see</legend>
        {status.posts.length === 0 ? (
          <p class="muted">
            No posts to show yet. If you have posted recently, press “Refresh now”.
          </p>
        ) : (
          <ul class="ig-preview" aria-label="Latest Instagram posts">
            {status.posts.map((p) => (
              <li key={`${p.kind}-${p.code}`}>
                <img
                  src={assetUrl(p.image)}
                  alt={p.caption || 'Instagram post'}
                  width="96"
                  height="120"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                />
                {p.video && <span class="ig-tag">Reel</span>}
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </>
  );
}
