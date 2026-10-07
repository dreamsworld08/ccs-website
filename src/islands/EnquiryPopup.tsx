import { useEffect, useRef, useState } from 'preact/hooks';
import EnquiryForm, { type FormContact } from './EnquiryForm';
import { markPopupShown, popupAlreadyShown, type OpenDetail } from '../lib/enquiry';
import { iconSvg } from '../lib/icons';

type Props = FormContact & {
  /** Auto-open once per session (after 20 s or 50 % scroll). Off on landing pages. */
  autoOpen: boolean;
  benefits: string[];
};

type PendingWindow = Window & { __ccsPending?: OpenDetail | null };

/**
 * Uses the browser's native <dialog>: the platform provides the focus trap, Esc to close,
 * inert background and focus restoration, so there is far less JavaScript to ship to phones.
 */
export default function EnquiryPopup({ autoOpen, benefits, years, whatsapp, phone }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [detail, setDetail] = useState<OpenDetail>({});

  function show(d: OpenDetail) {
    const dlg = ref.current;
    if (!dlg || dlg.open) return;
    setDetail(d);
    setOpenCount((n) => n + 1); // remount the form so a reopened popup starts clean
    setOpen(true);
    dlg.showModal();
    markPopupShown();
  }

  // Open on any "Enquire now" / "Book free counselling" click (see Base layout script).
  useEffect(() => {
    const w = window as PendingWindow;
    const handler = (e: Event) => {
      w.__ccsPending = null;
      show((e as CustomEvent<OpenDetail>).detail ?? {});
    };
    window.addEventListener('ccs:open-enquiry', handler);
    if (w.__ccsPending) {
      const d = w.__ccsPending;
      w.__ccsPending = null;
      show(d);
    }
    return () => window.removeEventListener('ccs:open-enquiry', handler);
  }, []);

  // Auto-open ONCE per browser session: after 20 s or when 50 % of the page is scrolled.
  useEffect(() => {
    if (!autoOpen || popupAlreadyShown()) return;
    let fired = false;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0 && window.scrollY / max >= 0.5) fire();
    };
    const timer = window.setTimeout(() => fire(), 20000);
    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    }
    function fire() {
      if (fired) return;
      fired = true;
      cleanup();
      // Never interrupt the mobile menu or another open dialog.
      if (
        !popupAlreadyShown() &&
        document.body.dataset.navOpen !== 'true' &&
        document.body.dataset.searchOpen !== 'true'
      )
        show({ source: 'popup' });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return cleanup;
  }, [autoOpen]);

  function close() {
    ref.current?.close();
  }

  return (
    <dialog
      ref={ref}
      class="ccs-dialog"
      aria-labelledby="enquiry-popup-title"
      onClose={() => setOpen(false)}
      onClick={(e) => {
        // A click on the dialog element itself (not its content) is a click on the backdrop.
        if (e.target === ref.current) close();
      }}
    >
      {open && (
        <>
          <aside class="hidden md:flex flex-col justify-between p-10 text-white on-primary bg-[linear-gradient(160deg,#0A1B5C_0%,#0042F6_60%,#6047FF_130%)]">
            <div>
              <span class="chip chip-kicker mb-6">Free counselling</span>
              <p class="h2 !text-[44px] mb-8">Start your civil services journey</p>
              <ul class="grid gap-4">
                {benefits.map((b) => (
                  <li class="flex gap-3 items-start text-[16px]">
                    <span
                      class="mt-[2px] shrink-0 inline-flex w-6 h-6 items-center justify-center rounded-full bg-white/20"
                      dangerouslySetInnerHTML={{ __html: iconSvg('check', 14) }}
                    />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <p class="mono text-[12px] uppercase tracking-wider text-white/70">
              Chandigarh Civil Services
            </p>
          </aside>

          <div class="overflow-y-auto overscroll-contain p-5 pt-3 md:p-10 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-10 min-w-0">
            <div
              class="md:hidden mx-auto mb-3 h-1.5 w-12 rounded-full bg-line"
              aria-hidden="true"
            />
            <div class="flex items-start justify-between gap-4 mb-5">
              <div class="min-w-0">
                <h2 id="enquiry-popup-title" class="h3 !text-[26px] md:!text-[28px]">
                  Book free counselling
                </h2>
                <p class="text-muted text-[15px] mt-2">
                  Tell us a little about you. We call within 24 hours.
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-full bg-panel hover:bg-line"
                onClick={close}
                aria-label="Close enquiry form"
                dangerouslySetInnerHTML={{ __html: iconSvg('x', 20) }}
              />
            </div>
            <EnquiryForm
              key={openCount}
              idPrefix="popup"
              years={years}
              whatsapp={whatsapp}
              phone={phone}
              defaultExam={detail.exam ?? ''}
              source={detail.source ?? 'popup'}
            />
          </div>
        </>
      )}
    </dialog>
  );
}
