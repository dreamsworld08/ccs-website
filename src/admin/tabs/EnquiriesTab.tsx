import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { call } from '../api';
import { EXAMS, STATUSES } from '../schemas';
import { Banner, fmtIst, istDay, toast, useInterval } from '../ui';
import { csvCell } from '../format';

export type Row = {
  row_id: string;
  received: string;
  name: string;
  mobile: string;
  email: string;
  exam: string;
  year: string;
  city: string;
  message: string;
  source: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  status: string;
  notes: string;
  last_updated: string;
  updated_by: string;
};

const PAGE_SIZE = 50;
/** Year of attempt is optional on the form, so "not given" needs its own filter choice. */
const NO_YEAR = '__none__';
const RANGES: [string, string][] = [
  ['all', 'All time'],
  ['today', 'Today'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['year', 'This year'],
  ['custom', 'Custom'],
];

export const sourceLabel = (s: string) =>
  s === 'popup'
    ? 'Popup'
    : s === 'exam_updates_signup'
      ? 'Exam updates sign-up'
      : s.startsWith('lp:')
        ? `Landing: ${s.slice(3)}`
        : `Page: ${s}`;

const todayIst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function EnquiriesTab({ attemptYears }: { attemptYears: string[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const editingNotes = useRef(0);

  // filters
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exam, setExam] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  async function load(silent = false) {
    if (!silent) setError('');
    setRefreshing(true);
    const res = await call<{ rows: Row[] }>('listEnquiries');
    setRefreshing(false);
    if (res.ok) {
      setRows(res.rows);
      setLoadedAt(new Date());
      setError('');
    } else if (!silent && res.code !== 'auth') setError(res.error || 'Could not load enquiries.');
  }
  useEffect(() => void load(), []);
  // Auto-refresh every 60 s, but never while a note is being typed or the tab is hidden.
  useInterval(() => {
    if (!document.hidden && editingNotes.current === 0) void load(true);
  }, 60000);

  const sources = useMemo(() => [...new Set((rows ?? []).map((r) => r.source))].sort(), [rows]);

  const filtered = useMemo(() => {
    const today = todayIst();
    let min = '';
    let max = '';
    if (range === 'today') min = today;
    else if (range === '7') min = addDays(today, -6);
    else if (range === '30') min = addDays(today, -29);
    else if (range === 'year') min = `${today.slice(0, 4)}-01-01`;
    else if (range === 'custom') {
      min = from;
      max = to;
    }
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      const day = istDay(r.received);
      if (min && day < min) return false;
      if (max && day > max) return false;
      if (exam && r.exam !== exam) return false;
      if (year === NO_YEAR ? r.year !== '' : year && r.year !== year) return false;
      if (status && r.status !== status) return false;
      if (source && r.source !== source) return false;
      if (needle && !`${r.name} ${r.mobile} ${r.email} ${r.city}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [rows, range, from, to, exam, year, status, source, q]);

  useEffect(() => setPage(1), [range, from, to, exam, year, status, source, q]);

  // ---- summary tables, recalculated for the active filters
  const byStatus = useMemo(() => {
    const c: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of filtered) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [filtered]);

  const matrix = useMemo(() => {
    const years = [
      ...new Set([...attemptYears, ...(rows ?? []).map((r) => r.year).filter(Boolean)]),
    ].sort();
    const hasBlank = filtered.some((r) => !r.year);
    const exams = [...new Set([...EXAMS, ...filtered.map((r) => r.exam).filter(Boolean)])];
    const cols = hasBlank ? [...years, ''] : years;
    const cell = (e: string, y: string) =>
      filtered.filter((r) => r.exam === e && r.year === y).length;
    return { cols, exams, cell };
  }, [filtered, rows, attemptYears]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function update(row: Row, patch: { status?: string; notes?: string }) {
    const prev = { status: row.status, notes: row.notes };
    setRows((rs) => rs!.map((r) => (r.row_id === row.row_id ? { ...r, ...patch } : r)));
    const res = await call<{ last_updated: string; updated_by: string }>('updateEnquiry', {
      row_id: row.row_id,
      ...patch,
    });
    if (res.ok) {
      setRows((rs) =>
        rs!.map((r) =>
          r.row_id === row.row_id
            ? { ...r, last_updated: res.last_updated, updated_by: res.updated_by }
            : r,
        ),
      );
      setSaved((s) => ({ ...s, [row.row_id]: Date.now() }));
      setTimeout(
        () =>
          setSaved((s) => {
            const n = { ...s };
            delete n[row.row_id];
            return n;
          }),
        2200,
      );
    } else {
      setRows((rs) => rs!.map((r) => (r.row_id === row.row_id ? { ...r, ...prev } : r)));
      if (res.code !== 'auth') toast(res.error || 'Could not save the change.', 'error', 7000);
    }
  }

  function exportCsv() {
    const head = [
      'Received (IST)',
      'Name',
      'Mobile',
      'Email',
      'Exam',
      'Year of attempt',
      'City',
      'Message',
      'Source',
      'UTM source',
      'UTM medium',
      'UTM campaign',
      'Status',
      'Notes',
      'Last updated',
      'Updated by',
    ];
    const lines = [head.map(csvCell).join(',')];
    for (const r of filtered) {
      lines.push(
        [
          fmtIst(r.received),
          r.name,
          r.mobile,
          r.email,
          r.exam,
          r.year,
          r.city,
          r.message,
          r.source,
          r.utm_source,
          r.utm_medium,
          r.utm_campaign,
          r.status,
          r.notes,
          fmtIst(r.last_updated),
          r.updated_by,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ccs-enquiries-${todayIst()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const yearOptions = [
    ...new Set([...attemptYears, ...(rows ?? []).map((r) => r.year).filter(Boolean)]),
  ].sort();

  return (
    <section>
      <div class="tab-head">
        <h1>Enquiries</h1>
        <div class="tab-actions">
          <span class="muted small">
            {loadedAt
              ? `Updated ${loadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`
              : ''}
          </span>
          <button class="btn" onClick={() => load()} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button class="btn" onClick={exportCsv} disabled={!filtered.length}>
            Export CSV ({filtered.length})
          </button>
        </div>
      </div>

      {error && (
        <Banner kind="error">
          {error}{' '}
          <button class="btn btn-sm" onClick={() => load()}>
            Retry
          </button>
        </Banner>
      )}
      {!rows && !error && <p class="muted">Loading enquiries…</p>}

      {rows && (
        <>
          <div class="summary">
            <div class="table-wrap">
              <table class="table table-compact" aria-label="Enquiries by status">
                <caption>By status</caption>
                <thead>
                  <tr>
                    {STATUSES.map((s) => (
                      <th>{s}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {STATUSES.map((s) => (
                      <td class="mono">{byStatus[s] ?? 0}</td>
                    ))}
                    <td class="mono strong">{filtered.length}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="table-wrap">
              <table class="table table-compact" aria-label="Enquiries by exam and year of attempt">
                <caption>By exam × year of attempt</caption>
                <thead>
                  <tr>
                    <th>Exam</th>
                    {matrix.cols.map((y) => (
                      <th>{y || 'No year'}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.exams.map((e) => (
                    <tr>
                      <td>{e}</td>
                      {matrix.cols.map((y) => (
                        <td class="mono">{matrix.cell(e, y)}</td>
                      ))}
                      <td class="mono strong">
                        {matrix.cols.reduce((n, y) => n + matrix.cell(e, y), 0)}
                      </td>
                    </tr>
                  ))}
                  <tr class="total-row">
                    <td>Total</td>
                    {matrix.cols.map((y) => (
                      <td class="mono">
                        {matrix.exams.reduce((n, e) => n + matrix.cell(e, y), 0)}
                      </td>
                    ))}
                    <td class="mono strong">{filtered.length}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="filters" role="search" aria-label="Filter enquiries">
            <label>
              Date
              <select
                value={range}
                onChange={(e) => setRange((e.target as HTMLSelectElement).value)}
              >
                {RANGES.map(([v, l]) => (
                  <option value={v}>{l}</option>
                ))}
              </select>
            </label>
            {range === 'custom' && (
              <>
                <label>
                  From{' '}
                  <input
                    type="date"
                    value={from}
                    onInput={(e) => setFrom((e.target as HTMLInputElement).value)}
                  />
                </label>
                <label>
                  To{' '}
                  <input
                    type="date"
                    value={to}
                    onInput={(e) => setTo((e.target as HTMLInputElement).value)}
                  />
                </label>
              </>
            )}
            <label>
              Exam
              <select value={exam} onChange={(e) => setExam((e.target as HTMLSelectElement).value)}>
                <option value="">All</option>
                {[...new Set([...EXAMS, ...rows.map((r) => r.exam)])].map((x) => (
                  <option>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Year of attempt
              <select value={year} onChange={(e) => setYear((e.target as HTMLSelectElement).value)}>
                <option value="">All</option>
                {yearOptions.map((x) => (
                  <option>{x}</option>
                ))}
                <option value={NO_YEAR}>Not given</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
              >
                <option value="">All</option>
                {STATUSES.map((x) => (
                  <option>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select
                value={source}
                onChange={(e) => setSource((e.target as HTMLSelectElement).value)}
              >
                <option value="">All</option>
                {sources.map((x) => (
                  <option value={x}>{sourceLabel(x)}</option>
                ))}
              </select>
            </label>
            <label class="grow">
              Search
              <input
                type="search"
                placeholder="Name, mobile, email or city"
                value={q}
                onInput={(e) => setQ((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>

          {filtered.length === 0 ? (
            <p class="empty">
              {rows.length === 0
                ? 'No enquiries yet. They will appear here the moment someone submits a form.'
                : 'No enquiries match these filters.'}
            </p>
          ) : (
            <>
              <div class="table-wrap">
                <table class="table table-enq">
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>Name</th>
                      <th>Mobile</th>
                      <th>Email</th>
                      <th>Exam</th>
                      <th>Year</th>
                      <th>City</th>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Notes</th>
                      <th>Last updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.row_id}>
                        <td class="nowrap mono small">{fmtIst(r.received)}</td>
                        <td>
                          {r.name}
                          {r.message && (
                            <div class="muted small" title={r.message}>
                              “{r.message.length > 60 ? `${r.message.slice(0, 60)}…` : r.message}”
                            </div>
                          )}
                        </td>
                        <td class="nowrap mono">
                          {r.mobile}
                          <div class="small">
                            <a href={`tel:+91${r.mobile}`}>Call</a> ·{' '}
                            <a
                              href={`https://wa.me/91${r.mobile}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              WhatsApp
                            </a>
                          </div>
                        </td>
                        <td class="small">{r.email || '—'}</td>
                        <td>{r.exam}</td>
                        <td class="mono">{r.year || '—'}</td>
                        <td>{r.city || '—'}</td>
                        <td class="small">{sourceLabel(r.source)}</td>
                        <td class="nowrap">
                          <select
                            class={`pill pill-${r.status.toLowerCase()}`}
                            value={r.status}
                            aria-label={`Status for ${r.name}`}
                            onChange={(e) =>
                              update(r, { status: (e.target as HTMLSelectElement).value })
                            }
                          >
                            {STATUSES.map((s) => (
                              <option>{s}</option>
                            ))}
                          </select>
                          {saved[r.row_id] && (
                            <span class="tick" role="status">
                              {' '}
                              ✓ Saved
                            </span>
                          )}
                        </td>
                        <td class="notes-cell">
                          <NotesCell
                            row={r}
                            onSave={(notes) => update(r, { notes })}
                            onEditing={(on) => (editingNotes.current += on ? 1 : -1)}
                          />
                        </td>
                        <td class="nowrap small">
                          {fmtIst(r.last_updated)}
                          {r.updated_by && <div class="muted">{r.updated_by}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div class="pager">
                <span class="muted">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}{' '}
                  of {filtered.length}
                </span>
                <button class="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <span class="mono">
                  {page} / {pages}
                </span>
                <button
                  class="btn btn-sm"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Click to edit, saves on blur (only if the text changed). */
function NotesCell({
  row,
  onSave,
  onEditing,
}: {
  row: Row;
  onSave: (n: string) => void;
  onEditing: (on: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.notes);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) setText(row.notes);
  }, [row.notes, editing]);
  if (!editing) {
    return (
      <button
        class="notes-btn"
        onClick={() => {
          setEditing(true);
          onEditing(true);
        }}
        aria-label={`Edit notes for ${row.name}`}
      >
        {row.notes || <span class="muted">Add note</span>}
      </button>
    );
  }
  return (
    <textarea
      class="notes-input"
      rows={2}
      maxLength={1000}
      value={text}
      autoFocus
      aria-label={`Notes for ${row.name}`}
      onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      onBlur={() => {
        setEditing(false);
        onEditing(false);
        if (!cancelled.current && text !== row.notes) onSave(text);
        cancelled.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true;
          setText(row.notes);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}
