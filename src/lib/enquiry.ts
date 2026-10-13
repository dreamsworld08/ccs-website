import { callBackend } from './api';

const LAST_KEY = 'ccs_last_submit';
const UTM_KEY = 'ccs_utm';
const POPUP_KEY = 'ccs_popup_shown';
export const COOLDOWN_MS = 60_000;

/* Storage can throw (private mode, blocked cookies): never let that break a form. */
const safe = {
  get(store: 'local' | 'session', key: string): string | null {
    try {
      return (store === 'local' ? localStorage : sessionStorage).getItem(key);
    } catch {
      return null;
    }
  },
  set(store: 'local' | 'session', key: string, value: string) {
    try {
      (store === 'local' ? localStorage : sessionStorage).setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

export type Utm = { utm_source: string; utm_medium: string; utm_campaign: string };

/** Read utm_* from the URL once and keep them for the rest of the session. */
export function captureUtm(): Utm {
  const params = new URLSearchParams(window.location.search);
  const fresh: Utm = {
    utm_source: params.get('utm_source') ?? '',
    utm_medium: params.get('utm_medium') ?? '',
    utm_campaign: params.get('utm_campaign') ?? '',
  };
  if (fresh.utm_source || fresh.utm_medium || fresh.utm_campaign) {
    safe.set('session', UTM_KEY, JSON.stringify(fresh));
    return fresh;
  }
  return getUtm();
}
export function getUtm(): Utm {
  try {
    const raw = safe.get('session', UTM_KEY);
    if (raw) return { utm_source: '', utm_medium: '', utm_campaign: '', ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { utm_source: '', utm_medium: '', utm_campaign: '' };
}

export const popupAlreadyShown = () => safe.get('session', POPUP_KEY) === '1';
export const markPopupShown = () => safe.set('session', POPUP_KEY, '1');

export function cooldownRemainingMs(): number {
  const last = Number(safe.get('local', LAST_KEY) ?? 0);
  return Math.max(0, COOLDOWN_MS - (Date.now() - last));
}
export const markSubmitted = () => safe.set('local', LAST_KEY, String(Date.now()));

/** Page path relative to the site base, e.g. "/", "/courses/". */
export function currentSource(): string {
  const base = (document.documentElement.dataset.base ?? '').replace(/\/$/, '');
  let p = window.location.pathname;
  if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
  return p || '/';
}

/* ---- validation (mirrors the checks in the backend) ---- */
export function normalizeMobile(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
export const isValidMobile = (m: string) => /^[6-9]\d{9}$/.test(m);
export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/** Name, mobile and exam are mandatory; everything else is optional. */
export type EnquiryInput = {
  name: string;
  mobile: string;
  exam: string;
  email?: string;
  year?: string;
  city?: string;
  message?: string;
  source: string;
  website?: string; // honeypot
};

/**
 * A backend that has not been updated yet only knows the exam names the site used before IAS / PCS / HPAS / HCS and
 * refuses the new ones with "Please select the exam you are preparing for". Rather than lose that enquiry, it is sent
 * again in words the old backend accepts: IAS and PCS under their old names, HPAS and HCS as "Other" with the exam named
 * in the message. An updated backend accepts the new names, so this never runs there.
 */
const OLD_BACKEND_EXAM: Record<string, string> = { IAS: 'UPSC CSE', PCS: 'Punjab PSC (PCS)' };

export async function sendEnquiry(input: EnquiryInput) {
  const utm = getUtm();
  const send = (exam: string, message: string) =>
    callBackend('submitEnquiry', {
      name: input.name.trim(),
      mobile: input.mobile,
      email: (input.email ?? '').trim(),
      exam,
      year: input.year ?? '',
      city: (input.city ?? '').trim(),
      message,
      source: input.source,
      website: input.website ?? '',
      ...utm,
    });
  const message = (input.message ?? '').trim();
  let result = await send(input.exam, message);
  if (
    !result.ok &&
    result.code === 'invalid' &&
    /exam you are preparing for/i.test(result.error ?? '') &&
    input.exam !== 'Other'
  ) {
    const old = OLD_BACKEND_EXAM[input.exam];
    result = await send(old ?? 'Other', old ? message : `Exam: ${input.exam}. ${message}`.trim());
  }
  if (result.ok) markSubmitted();
  return result;
}

export type OpenDetail = { exam?: string; source?: string };
export function openEnquiry(detail: OpenDetail = {}) {
  (window as unknown as { __ccsPending?: OpenDetail | null }).__ccsPending = detail;
  window.dispatchEvent(new CustomEvent('ccs:open-enquiry', { detail }));
}
