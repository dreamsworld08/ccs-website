import { useEffect, useState } from 'preact/hooks';
import {
  call,
  clearSession,
  getItem,
  loadSession,
  saveSession,
  siteBase,
  type Session,
} from './api';
import { COURSES, EXAM_UPDATES, REELS, RESOURCES, RESULTS, TEACHERS, TESTS } from './schemas';
import { Toasts } from './ui';
import EnquiriesTab from './tabs/EnquiriesTab';
import ContentTab from './tabs/ContentTab';
import HomeTab from './tabs/HomeTab';
import InstagramTab from './tabs/InstagramTab';
import LandingPagesTab from './tabs/LandingPagesTab';
import SettingsTab from './tabs/SettingsTab';
import { IS_LOCAL_BACKEND } from '../config/backend';

const TABS = [
  ['enquiries', 'Enquiries'],
  ['home', 'Home Page'],
  ['courses', 'Courses'],
  ['results', 'Results'],
  ['reels', 'Reels'],
  ['instagram', 'Instagram'],
  ['teachers', 'Teachers'],
  ['resources', 'Free Resources'],
  ['exam-updates', 'Exam Updates'],
  ['landing-pages', 'Landing Pages'],
  ['settings', 'Settings'],
] as const;

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [tab, setTab] = useState<string>(() => location.hash.slice(1) || 'enquiries');
  // Clickjacking guard: GitHub Pages cannot send frame-ancestors, so the page refuses to run framed.
  const framed = window.self !== window.top;

  // Auto-logout: when the token expires, or any call reports it is no longer valid.
  useEffect(() => {
    if (!session) return;
    const ms = session.expiresAt - Date.now();
    const t = setTimeout(logout, Math.max(0, ms));
    const onExpired = () => setSession(null);
    window.addEventListener('ccs:session-expired', onExpired);
    return () => {
      clearTimeout(t);
      window.removeEventListener('ccs:session-expired', onExpired);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      const res = await getItem('settings/site.json');
      if (res.ok) setSettings((res as any).data);
    })();
  }, [session]);

  useEffect(() => {
    const onHash = () => setTab(location.hash.slice(1) || 'enquiries');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function logout() {
    clearSession();
    setSession(null);
    setSettings(null);
  }

  if (framed)
    return <p style={{ padding: '24px' }}>This page cannot be displayed inside another page.</p>;

  if (!session) {
    return (
      <>
        <Login
          onLogin={(s) => {
            setSession(s);
            if (!location.hash) location.hash = 'enquiries';
          }}
        />
        <Toasts />
      </>
    );
  }

  const showTests = Boolean(settings?.show_free_tests);
  const tabs = showTests
    ? [...TABS.slice(0, 9), ['tests', 'Free Tests'] as const, ...TABS.slice(9)]
    : [...TABS];
  const active = tabs.some(([id]) => id === tab) ? tab : 'enquiries';

  return (
    <div class="admin">
      <header class="topbar">
        <div class="brand">
          <img src={`${siteBase()}/brand/logo-mark.webp`} alt="CCS" width="34" height="34" />
          <span class="brand-sub">Admin</span>
        </div>
        <nav class="tabs" aria-label="Admin sections">
          {tabs.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              class={`tab ${active === id ? 'tab-active' : ''}`}
              aria-current={active === id ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <div class="who">
          <span class="who-name">{session.name}</span>
          <button class="btn btn-sm" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      {IS_LOCAL_BACKEND && (
        <div class="localbar">
          Local mode: edits are written straight to your project files and the dev database, not to
          GitHub or Google Sheets.
        </div>
      )}
      <main class="content">
        {active === 'enquiries' && (
          <EnquiriesTab attemptYears={settings?.attempt_years ?? ['2027', '2028', '2029']} />
        )}
        {active === 'home' && <HomeTab />}
        {active === 'courses' && <ContentTab def={COURSES} />}
        {active === 'results' && <ContentTab def={RESULTS} />}
        {active === 'reels' && <ContentTab def={REELS} />}
        {active === 'instagram' && <InstagramTab />}
        {active === 'teachers' && <ContentTab def={TEACHERS} />}
        {active === 'resources' && <ContentTab def={RESOURCES} />}
        {active === 'exam-updates' && <ContentTab def={EXAM_UPDATES} />}
        {active === 'tests' && showTests && <ContentTab def={TESTS} />}
        {active === 'landing-pages' && <LandingPagesTab />}
        {active === 'settings' && <SettingsTab onSettings={setSettings} />}
      </main>
      <Toasts />
    </div>
  );
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await call<{
      token: string;
      name: string;
      email: string;
      expires_in: number;
    }>('login', { email, password });
    setBusy(false);
    if (!res.ok) {
      setPassword('');
      return void setError(
        res.code === 'network'
          ? 'Cannot reach the server. Check your connection.'
          : (res.error ?? 'Login failed.'),
      );
    }
    const s: Session = {
      token: res.token,
      name: res.name,
      email: res.email,
      expiresAt: Date.now() + res.expires_in * 1000,
    };
    saveSession(s);
    onLogin(s);
  }

  return (
    <div class="login-wrap">
      <form class="login" onSubmit={submit}>
        <img
          class="login-logo"
          src={`${siteBase()}/brand/logo-full.webp`}
          alt="Chandigarh Civil Services"
          width="120"
          height="120"
        />
        <h1>Admin login</h1>
        <label>
          Login
          <input
            type="text"
            value={email}
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            required
            autoFocus
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autocomplete="current-password"
            required
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </label>
        {error && (
          <p class="login-error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p class="help">
          Staff only. Content saved here goes live on the website in about 2 minutes.
        </p>
      </form>
    </div>
  );
}
