import { useEffect, useState } from 'preact/hooks';

/** Countdown to a date. Dates without a timezone are read as Indian Standard Time. */
export default function Countdown({ date }: { date: string }) {
  const target = new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(date) ? date : `${date}+05:30`).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, target - Date.now()));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [target]);

  if (Number.isNaN(target)) return null;
  if (left === 0) return null;

  const s = Math.floor((left ?? 0) / 1000);
  const parts = [
    { v: Math.floor(s / 86400), l: 'Days' },
    { v: Math.floor((s % 86400) / 3600), l: 'Hours' },
    { v: Math.floor((s % 3600) / 60), l: 'Mins' },
    { v: s % 60, l: 'Secs' },
  ];
  return (
    <div role="timer" aria-label="Time left" class="grid grid-cols-4 gap-2 max-w-[420px]">
      {parts.map((p) => (
        <div class="rounded-[16px] bg-white/12 border border-white/20 px-2 py-3 text-center">
          <div class="mono text-[26px] md:text-[32px] font-medium leading-none tabular-nums">
            {left === null ? '--' : String(p.v).padStart(2, '0')}
          </div>
          <div class="mono mt-1.5 text-[11px] uppercase tracking-wider text-white/70">{p.l}</div>
        </div>
      ))}
    </div>
  );
}
