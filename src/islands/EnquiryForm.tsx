import { useState } from 'preact/hooks';
import {
  cooldownRemainingMs,
  currentSource,
  isValidEmail,
  isValidMobile,
  normalizeMobile,
  sendEnquiry,
} from '../lib/enquiry';
import { iconSvg } from '../lib/icons';

export const EXAMS = ['UPSC CSE', 'Punjab PSC (PCS)', 'Punjab One Day Exams', 'Other'];

export type FormContact = { years: string[]; whatsapp: string; phone: string };

type Props = FormContact & {
  /** Exam preselected in the dropdown. */
  defaultExam?: string;
  /** Overrides the auto source (page path). Landing pages pass "lp:<slug>". */
  source?: string;
  idPrefix: string;
  submitLabel?: string;
  onSuccess?: () => void;
};

type Errors = Partial<Record<'name' | 'mobile' | 'email' | 'exam', string>>;
type Status = 'idle' | 'submitting' | 'success' | 'error';

const PRIVACY_HREF = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/privacy-policy/`;
const waHref = (n: string) =>
  `https://wa.me/${n.replace(/\D/g, '')}?text=${encodeURIComponent('Hi CCS, I just submitted an enquiry on your website.')}`;
const telHref = (p: string) => `tel:+${p.replace(/\D/g, '')}`;

export default function EnquiryForm(props: Props) {
  const { years, whatsapp, phone, idPrefix } = props;
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [exam, setExam] = useState(props.defaultExam ?? '');
  const [year, setYear] = useState('');
  const [city, setCity] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [moreOpen, setMoreOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>('idle');
  const [formError, setFormError] = useState('');

  const id = (f: string) => `${idPrefix}-${f}`;

  /** Only name, mobile number and exam are mandatory. Year, email, city and message are optional. */
  function validate(): Errors {
    const e: Errors = {};
    const n = name.trim();
    if (n.length < 2 || n.length > 60) e.name = 'Enter your full name (2 to 60 characters).';
    if (!isValidMobile(normalizeMobile(mobile)))
      e.mobile = 'Enter a valid 10-digit mobile number starting with 6 to 9.';
    if (!exam) e.exam = 'Select the exam you are preparing for.';
    // Optional, but if it is typed it must be usable.
    if (email.trim() && !isValidEmail(email.trim())) e.email = 'Enter a valid email address.';
    return e;
  }

  async function onSubmit(ev: Event) {
    ev.preventDefault();
    if (status === 'submitting') return;
    const e = validate();
    setErrors(e);
    if (e.email) setMoreOpen(true);
    if (Object.keys(e).length) {
      const first = (['name', 'mobile', 'exam', 'email'] as const).find((k) => e[k]);
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    const wait = cooldownRemainingMs();
    if (wait > 0) {
      setStatus('error');
      setFormError(
        `We already received your enquiry. Please wait ${Math.ceil(wait / 1000)} seconds before sending another.`,
      );
      return;
    }
    setStatus('submitting');
    setFormError('');
    const result = await sendEnquiry({
      name,
      mobile: normalizeMobile(mobile),
      email,
      exam,
      year,
      city,
      message,
      source: props.source ?? currentSource(),
      website,
    });
    // The same number twice within 10 minutes is a double-tap, not an error: show success.
    if (result.ok || result.code === 'duplicate') {
      setStatus('success');
      props.onSuccess?.();
      return;
    }
    setStatus('error');
    setFormError(
      result.code === 'network' || result.code === 'bad_response' ? '' : (result.error ?? ''),
    );
  }

  if (status === 'success') {
    return (
      <div class="text-center py-8 px-2" role="status" aria-live="polite">
        <span
          class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-mint text-success mb-5"
          dangerouslySetInnerHTML={{ __html: iconSvg('circle-check', 34) }}
        />
        <p class="h3 mb-3">Thanks, we have your details</p>
        <p class="text-muted mb-6">Thanks, our team will call you within 24 hours.</p>
        <a class="btn btn-primary" href={waHref(whatsapp)} target="_blank" rel="noopener">
          <span dangerouslySetInnerHTML={{ __html: iconSvg('whatsapp', 18) }} />
          Chat on WhatsApp
        </a>
      </div>
    );
  }

  const invalid = (k: keyof Errors) => (errors[k] ? 'true' : undefined);
  const describedBy = (k: keyof Errors) => (errors[k] ? id(`${k}-err`) : undefined);
  const Err = ({ k }: { k: keyof Errors }) =>
    errors[k] ? (
      <p class="field-error" id={id(`${k}-err`)} role="alert">
        {errors[k]}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} noValidate class="grid gap-4 text-ink" aria-label="Enquiry form">
      <div>
        <label class="field-label" for={id('name')}>
          Full name <span aria-hidden="true">*</span>
        </label>
        <input
          class="input"
          id={id('name')}
          name="name"
          type="text"
          autocomplete="name"
          maxLength={60}
          required
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          aria-invalid={invalid('name')}
          aria-describedby={describedBy('name')}
          placeholder="Your name"
        />
        <Err k="name" />
      </div>

      <div>
        <label class="field-label" for={id('mobile')}>
          Mobile number <span aria-hidden="true">*</span>
        </label>
        <div class="flex gap-2">
          <span
            class="inline-flex items-center px-4 rounded-[14px] bg-panel mono text-[15px] text-muted select-none"
            aria-hidden="true"
          >
            +91
          </span>
          <input
            class="input"
            id={id('mobile')}
            name="mobile"
            type="tel"
            inputMode="numeric"
            autocomplete="tel-national"
            maxLength={18}
            required
            value={mobile}
            onInput={(e) => setMobile((e.target as HTMLInputElement).value)}
            aria-invalid={invalid('mobile')}
            aria-describedby={describedBy('mobile')}
            placeholder="98765 43210"
          />
        </div>
        <Err k="mobile" />
      </div>

      <div>
        <label class="field-label" for={id('exam')}>
          Which exam are you preparing for? <span aria-hidden="true">*</span>
        </label>
        <select
          class="input"
          id={id('exam')}
          name="exam"
          required
          value={exam}
          onChange={(e) => setExam((e.target as HTMLSelectElement).value)}
          aria-invalid={invalid('exam')}
          aria-describedby={describedBy('exam')}
        >
          <option value="">Select exam</option>
          {EXAMS.map((x) => (
            <option value={x}>{x}</option>
          ))}
        </select>
        <Err k="exam" />
      </div>

      <div>
        <label class="field-label" for={id('year')}>
          Year of attempt <span class="text-muted font-normal">(optional)</span>
        </label>
        <select
          class="input"
          id={id('year')}
          name="year"
          value={year}
          onChange={(e) => setYear((e.target as HTMLSelectElement).value)}
        >
          <option value="">Not sure yet</option>
          {years.map((y) => (
            <option value={y}>{y}</option>
          ))}
        </select>
      </div>

      <details
        class="group rounded-[14px] border border-line px-4 py-1"
        open={moreOpen}
        onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] font-medium [&::-webkit-details-marker]:hidden">
          Add email, city or a message <span class="text-muted font-normal">(optional)</span>
          <span
            class="transition-transform group-open:rotate-180"
            dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 18) }}
          />
        </summary>
        <div class="grid gap-4 pt-2 pb-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="field-label" for={id('email')}>
                Email <span class="text-muted font-normal">(optional)</span>
              </label>
              <input
                class="input"
                id={id('email')}
                name="email"
                type="email"
                autocomplete="email"
                value={email}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                aria-invalid={invalid('email')}
                aria-describedby={describedBy('email')}
                placeholder="you@example.com"
              />
              <Err k="email" />
            </div>
            <div>
              <label class="field-label" for={id('city')}>
                City <span class="text-muted font-normal">(optional)</span>
              </label>
              <input
                class="input"
                id={id('city')}
                name="city"
                type="text"
                autocomplete="address-level2"
                maxLength={60}
                value={city}
                onInput={(e) => setCity((e.target as HTMLInputElement).value)}
                placeholder="Chandigarh"
              />
            </div>
          </div>

          <div>
            <label class="field-label" for={id('message')}>
              Message <span class="text-muted font-normal">(optional)</span>
            </label>
            <textarea
              class="input"
              id={id('message')}
              name="message"
              rows={2}
              maxLength={300}
              value={message}
              onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
              placeholder="Anything you'd like us to know"
            />
            <p class="mt-1 text-right text-[12px] text-muted mono" aria-hidden="true">
              {message.length}/300
            </p>
          </div>
        </div>
      </details>

      {/* Honeypot: real users never see or fill this. */}
      <div class="sr-only-x" aria-hidden="true">
        <label for={id('website')}>Leave this field empty</label>
        <input
          id={id('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autocomplete="off"
          value={website}
          onInput={(e) => setWebsite((e.target as HTMLInputElement).value)}
        />
      </div>

      {status === 'error' && (
        <div class="rounded-[14px] bg-peach p-4 text-[15px]" role="alert">
          <p class="font-medium mb-2">{formError || 'We could not send your enquiry right now.'}</p>
          <p class="text-muted mb-3">You can reach us directly instead:</p>
          <div class="flex flex-wrap gap-2">
            <a class="btn btn-dark btn-sm" href={telHref(phone)}>
              <span dangerouslySetInnerHTML={{ __html: iconSvg('phone', 16) }} />
              Call us
            </a>
            <a
              class="btn btn-primary btn-sm"
              href={waHref(whatsapp)}
              target="_blank"
              rel="noopener"
            >
              <span dangerouslySetInnerHTML={{ __html: iconSvg('whatsapp', 16) }} />
              WhatsApp us
            </a>
          </div>
        </div>
      )}

      <button class="btn btn-primary w-full" type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? (
          <>
            <span
              class="animate-spin"
              dangerouslySetInnerHTML={{ __html: iconSvg('loader-circle', 18) }}
            />
            Sending…
          </>
        ) : (
          <>
            {props.submitLabel ?? 'Book free counselling'}
            <span dangerouslySetInnerHTML={{ __html: iconSvg('arrow-right', 18) }} />
          </>
        )}
      </button>

      <p class="text-center text-[12px] leading-snug text-muted">
        By submitting you agree to be contacted by call or WhatsApp about your enquiry.{' '}
        <a
          class="underline underline-offset-2"
          href={PRIVACY_HREF}
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy Policy
        </a>
      </p>
    </form>
  );
}
