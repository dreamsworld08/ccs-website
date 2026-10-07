import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { siteBase } from './api';

/* ------------------------------------------------------------------ toasts */
type Toast = { id: number; text: string; kind: 'ok' | 'error' | 'info' };
let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();
export function toast(text: string, kind: Toast['kind'] = 'ok', ms = 5000) {
  const t = { id: nextId++, text, kind };
  toasts = [...toasts, t];
  subs.forEach((f) => f());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    subs.forEach((f) => f());
  }, ms);
}
export function Toasts() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export const SAVED_MSG = 'Saved. Live on the website in about 2 minutes.';
export const savedToast = (local?: boolean) => {
  toast(local ? 'Saved. (Local mode: the site shows it immediately.)' : SAVED_MSG, 'ok');
  if (!local) void watchBuild();
};

/* ------------------------------------------------------------------ deploy watcher */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function currentBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`${siteBase()}/build.json?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? (((await res.json()) as { id?: string }).id ?? null) : null;
  } catch {
    return null;
  }
}
let watching = false;
/**
 * After a save the site is rebuilt by GitHub Actions. /build.json names the build that is live, so
 * once its id changes we know the edit has been published. Polls every 15 s for up to 6 minutes.
 */
export async function watchBuild() {
  if (watching) return;
  watching = true;
  try {
    const before = await currentBuildId();
    if (!before) return; // no build.json (for example in local development): nothing to watch
    for (let i = 0; i < 24; i++) {
      await sleep(15000);
      const now = await currentBuildId();
      if (now && now !== before) {
        toast('Live now. Refresh the website to see your change.', 'ok', 10000);
        return;
      }
    }
  } finally {
    watching = false;
  }
}

/* ------------------------------------------------------------------ banner */
export function Banner({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warn' | 'error';
  children: ComponentChildren;
}) {
  return <div class={`banner banner-${kind}`}>{children}</div>;
}

/* ------------------------------------------------------------------ side drawer */
export function Drawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="drawer-wrap">
      <div class="drawer-backdrop" onClick={onClose} />
      <aside
        class="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header class="drawer-head">
          <h2>{title}</h2>
          <button type="button" class="btn" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div class="drawer-body">{children}</div>
        {footer && <footer class="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ misc helpers */
export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export const fmtIst = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};
/** YYYY-MM-DD in Indian Standard Time. */
export const istDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
};
