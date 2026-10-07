import { useState } from 'preact/hooks';
import { cooldownRemainingMs, isValidMobile, normalizeMobile, sendEnquiry } from '../lib/enquiry';
import { iconSvg } from '../lib/icons';
import { EXAMS } from './EnquiryForm';

type Props = { tone: 'dark' | 'light'; idPrefix: string; whatsapp: string; phone: string };

/** "Register for regular exam updates": saved to the enquiry sheet with source = exam_updates_signup. */
export default function ExamUpdatesSignup({ tone, idPrefix, whatsapp, phone }: Props) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [exam, setExam] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const dark = tone === 'dark';
  const id = (f: string) => `${idPrefix}-${f}`;

  async function onSubmit(ev: Event) {
    ev.preventDefault();
    if (status === 'submitting') return;
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Enter your name.';
    if (!isValidMobile(normalizeMobile(mobile)))
      e.mobile = 'Enter a valid 10-digit WhatsApp number.';
    if (!exam) e.exam = 'Select an exam.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const wait = cooldownRemainingMs();
    if (wait > 0) {
      setStatus('error');
      setMsg(`Please wait ${Math.ceil(wait / 1000)} seconds before registering again.`);
      return;
    }
    setStatus('submitting');
    const res = await sendEnquiry({
      name,
      mobile: normalizeMobile(mobile),
      exam,
      source: 'exam_updates_signup',
      website,
    });
    if (res.ok || res.code === 'duplicate') setStatus('success');
    else {
      setStatus('error');
      setMsg(res.code === 'network' || res.code === 'bad_response' ? '' : (res.error ?? ''));
    }
  }

  const surface = dark
    ? 'bg-white/[0.06] border border-white/15 text-white'
    : 'bg-white text-ink border border-line';
  const inputCls = dark
    ? 'input !bg-white/10 !text-white placeholder:!text-white/55 focus:!bg-white/15 focus:!border-white'
    : 'input';
  const labelCls = `field-label ${dark ? 'text-white/85' : ''}`;
  const errCls = dark ? 'text-[#FFB4A6]' : 'text-[#c0301a]';

  if (status === 'success') {
    return (
      <div class={`rounded-[28px] p-7 ${surface}`} role="status" aria-live="polite">
        <span
          class={`inline-flex w-12 h-12 items-center justify-center rounded-full mb-4 ${dark ? 'bg-white/15 text-white' : 'bg-mint text-success'}`}
          dangerouslySetInnerHTML={{ __html: iconSvg('circle-check', 26) }}
        />
        <p class="h3 mb-2">You are on the list</p>
        <p class={dark ? 'text-white/75' : 'text-muted'}>
          Thanks, we will WhatsApp you every important notification, date and result.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      class={`rounded-[28px] p-6 md:p-7 grid gap-4 ${surface}`}
      aria-label="Register for regular exam updates"
    >
      <div>
        <p class="h3">Register for regular exam updates</p>
        <p class={`text-[15px] mt-2 ${dark ? 'text-white/75' : 'text-muted'}`}>
          Notifications, dates, admit cards and results on WhatsApp. Free.
        </p>
      </div>
      <div>
        <label class={labelCls} for={id('name')}>
          Name
        </label>
        <input
          class={inputCls}
          id={id('name')}
          type="text"
          autocomplete="name"
          maxLength={60}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          aria-invalid={errors.name ? 'true' : undefined}
          aria-describedby={errors.name ? id('name-err') : undefined}
          placeholder="Your name"
        />
        {errors.name && (
          <p class={`mt-1 text-[13px] ${errCls}`} id={id('name-err')} role="alert">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label class={labelCls} for={id('mobile')}>
          WhatsApp number
        </label>
        <div class="flex gap-2">
          <span
            class={`inline-flex items-center px-4 rounded-[14px] mono text-[15px] ${dark ? 'bg-white/10 text-white/70' : 'bg-panel text-muted'}`}
            aria-hidden="true"
          >
            +91
          </span>
          <input
            class={inputCls}
            id={id('mobile')}
            type="tel"
            inputMode="numeric"
            autocomplete="tel-national"
            maxLength={18}
            value={mobile}
            onInput={(e) => setMobile((e.target as HTMLInputElement).value)}
            aria-invalid={errors.mobile ? 'true' : undefined}
            aria-describedby={errors.mobile ? id('mobile-err') : undefined}
            placeholder="98765 43210"
          />
        </div>
        {errors.mobile && (
          <p class={`mt-1 text-[13px] ${errCls}`} id={id('mobile-err')} role="alert">
            {errors.mobile}
          </p>
        )}
      </div>
      <div>
        <label class={labelCls} for={id('exam')}>
          Which exam are you preparing for?
        </label>
        <select
          class={`${inputCls} ${dark ? '[&>option]:text-ink' : ''}`}
          id={id('exam')}
          value={exam}
          onChange={(e) => setExam((e.target as HTMLSelectElement).value)}
          aria-invalid={errors.exam ? 'true' : undefined}
          aria-describedby={errors.exam ? id('exam-err') : undefined}
        >
          <option value="">Select exam</option>
          {EXAMS.map((x) => (
            <option value={x}>{x}</option>
          ))}
        </select>
        {errors.exam && (
          <p class={`mt-1 text-[13px] ${errCls}`} id={id('exam-err')} role="alert">
            {errors.exam}
          </p>
        )}
      </div>
      <div class="sr-only-x" aria-hidden="true">
        <label for={id('website')}>Leave this field empty</label>
        <input
          id={id('website')}
          type="text"
          tabIndex={-1}
          autocomplete="off"
          value={website}
          onInput={(e) => setWebsite((e.target as HTMLInputElement).value)}
        />
      </div>
      {status === 'error' && (
        <div class="rounded-[14px] bg-peach p-4 text-[15px] text-ink" role="alert">
          <p class="font-medium mb-2">{msg || 'We could not register you right now.'}</p>
          <div class="flex flex-wrap gap-2">
            <a class="btn btn-dark btn-sm" href={`tel:+${phone.replace(/\D/g, '')}`}>
              Call us
            </a>
            <a
              class="btn btn-primary btn-sm"
              href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener"
            >
              WhatsApp us
            </a>
          </div>
        </div>
      )}
      <button
        class={`btn ${dark ? 'btn-white' : 'btn-primary'} w-full`}
        type="submit"
        disabled={status === 'submitting'}
      >
        {status === 'submitting' ? 'Registering…' : 'Register for updates'}
        <span dangerouslySetInnerHTML={{ __html: iconSvg('arrow-right', 18) }} />
      </button>
      <p class={`text-[12px] ${dark ? 'text-white/60' : 'text-muted'}`}>
        By registering you agree to be contacted on WhatsApp about exam updates.
      </p>
    </form>
  );
}
