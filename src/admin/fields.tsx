import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { assetUrl, startUpload } from './api';
import { compressImage, fileToBase64, formatBytes } from './image';
import type { Field } from './schemas';
import { toast } from './ui';

export type FieldCtx = { courses?: { id: string; name: string }[]; adding?: boolean };
type Setter = (key: string, value: any) => void;

const youtubeId = (url: string) =>
  (url.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/,
  ) ||
    url.match(/^([\w-]{11})$/) ||
    [])[1] ?? '';

function Wrap({
  field,
  id,
  children,
  count,
}: {
  field: Field;
  id: string;
  children: ComponentChildren;
  count?: number;
}) {
  return (
    <div class="field">
      <label for={id}>
        {field.label}
        {field.required && <span class="req"> *</span>}
        {field.max && count !== undefined && (
          <span class={`counter ${count > field.max * 0.95 ? 'counter-warn' : ''}`}>
            {count}/{field.max}
          </span>
        )}
      </label>
      {children}
      {field.help && <p class="help">{field.help}</p>}
    </div>
  );
}

export function FieldInput({
  field,
  data,
  set,
  ctx,
  idPrefix,
}: {
  field: Field;
  data: Record<string, any>;
  set: Setter;
  ctx: FieldCtx;
  idPrefix: string;
}) {
  if (field.showIf && !field.showIf(data)) return null;
  const id = `${idPrefix}-${field.key}`;
  const value = data[field.key];
  const readOnly = field.addOnly && !ctx.adding;

  switch (field.type) {
    case 'text':
    case 'url':
    case 'date':
    case 'datetime':
    case 'number':
      return (
        <Wrap field={field} id={id} count={typeof value === 'string' ? value.length : undefined}>
          <input
            id={id}
            list={field.suggestions ? `${id}-list` : undefined}
            type={
              field.type === 'datetime'
                ? 'datetime-local'
                : field.type === 'url'
                  ? 'text'
                  : field.type
            }
            inputMode={field.type === 'url' ? 'url' : undefined}
            value={value ?? ''}
            maxLength={field.max}
            placeholder={field.placeholder}
            disabled={readOnly}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              set(field.key, field.type === 'number' ? (v === '' ? '' : Number(v)) : v);
            }}
          />
          {field.suggestions && (
            <datalist id={`${id}-list`}>
              {field.suggestions.map((s) => (
                <option value={s} />
              ))}
            </datalist>
          )}
        </Wrap>
      );

    case 'textarea':
      return (
        <Wrap field={field} id={id} count={String(value ?? '').length}>
          <textarea
            id={id}
            rows={3}
            value={value ?? ''}
            maxLength={field.max}
            placeholder={field.placeholder}
            onInput={(e) => set(field.key, (e.target as HTMLTextAreaElement).value)}
          />
        </Wrap>
      );

    case 'select':
      return (
        <Wrap field={field} id={id}>
          <select
            id={id}
            value={value ?? ''}
            disabled={readOnly}
            onChange={(e) => set(field.key, (e.target as HTMLSelectElement).value)}
          >
            {/* A stored value that is no longer one of the choices is still shown as it is, never swapped for the first choice. */}
            {(value && !field.options!.includes(value)
              ? [value, ...field.options!]
              : field.options!
            ).map((o) => (
              <option value={o}>{o}</option>
            ))}
          </select>
        </Wrap>
      );

    case 'checkbox':
      return (
        <div class="field field-check">
          <label>
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => set(field.key, (e.target as HTMLInputElement).checked)}
            />{' '}
            {field.label}
          </label>
          {field.help && <p class="help">{field.help}</p>}
        </div>
      );

    case 'image':
      return (
        <Wrap field={field} id={id}>
          <ImageField
            id={id}
            field={field}
            value={value ?? ''}
            onChange={(v) => set(field.key, v)}
          />
        </Wrap>
      );

    case 'file':
      return (
        <Wrap field={field} id={id}>
          <PdfField id={id} field={field} value={value ?? ''} onChange={(v) => set(field.key, v)} />
        </Wrap>
      );

    case 'video': {
      const v = String(value ?? '');
      const yt = youtubeId(v);
      const mp4 = !yt && /\.(mp4|webm)(\?.*)?$/i.test(v);
      return (
        <Wrap field={field} id={id}>
          <input
            id={id}
            type="text"
            inputMode="url"
            value={v}
            placeholder="https://www.youtube.com/watch?v=…"
            onInput={(e) => set(field.key, (e.target as HTMLInputElement).value)}
          />
          {yt && (
            <iframe
              class="video-preview"
              title="Video preview"
              src={`https://www.youtube-nocookie.com/embed/${yt}`}
              loading="lazy"
              allow="encrypted-media; picture-in-picture"
              allowFullScreen
            />
          )}
          {mp4 && <video class="video-preview" src={v} controls preload="metadata" />}
          {v && !yt && !mp4 && (
            <p class="help help-warn">
              This does not look like a YouTube or .mp4 link, so no video will play.
            </p>
          )}
        </Wrap>
      );
    }

    case 'strings': {
      const list: string[] = Array.isArray(value) ? value : [];
      const update = (next: string[]) => set(field.key, next);
      return (
        <Wrap field={field} id={id}>
          <div class="rows">
            {list.map((s, i) => (
              <div class="row-inline" key={i}>
                <input
                  aria-label={`${field.label} ${i + 1}`}
                  type="text"
                  value={s}
                  maxLength={field.max}
                  onInput={(e) =>
                    update(list.map((x, j) => (j === i ? (e.target as HTMLInputElement).value : x)))
                  }
                />
                <button
                  type="button"
                  class="btn btn-sm"
                  onClick={() => update(list.filter((_, j) => j !== i))}
                  aria-label={`Remove ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            ))}
            {(!field.maxItems || list.length < field.maxItems) && (
              <button type="button" class="btn btn-sm" onClick={() => update([...list, ''])}>
                Add
              </button>
            )}
          </div>
        </Wrap>
      );
    }

    case 'objects': {
      const list: Record<string, string>[] = Array.isArray(value) ? value : [];
      const update = (next: Record<string, string>[]) => set(field.key, next);
      const blank = () => Object.fromEntries(field.sub!.map((s) => [s.key, '']));
      // Fixed-size lists always show exactly maxItems rows.
      const rows = field.fixed
        ? Array.from({ length: field.maxItems! }, (_, i) => list[i] ?? blank())
        : list;
      return (
        <Wrap field={field} id={id}>
          <div class="rows">
            {rows.map((row, i) => (
              <fieldset class="objrow" key={i}>
                <legend>{field.fixed ? `#${i + 1}` : `Item ${i + 1}`}</legend>
                {field.sub!.map((s) => (
                  <div class="field">
                    <label>
                      {s.label}
                      {s.max && (
                        <span class="counter">
                          {String(row[s.key] ?? '').length}/{s.max}
                        </span>
                      )}
                    </label>
                    {s.type === 'textarea' ? (
                      <textarea
                        rows={2}
                        value={row[s.key] ?? ''}
                        maxLength={s.max}
                        onInput={(e) =>
                          update(
                            rows.map((r, j) =>
                              j === i
                                ? { ...r, [s.key]: (e.target as HTMLTextAreaElement).value }
                                : r,
                            ),
                          )
                        }
                      />
                    ) : (
                      <input
                        type="text"
                        value={row[s.key] ?? ''}
                        maxLength={s.max}
                        onInput={(e) =>
                          update(
                            rows.map((r, j) =>
                              j === i ? { ...r, [s.key]: (e.target as HTMLInputElement).value } : r,
                            ),
                          )
                        }
                      />
                    )}
                  </div>
                ))}
                {!field.fixed && (
                  <button
                    type="button"
                    class="btn btn-sm"
                    onClick={() => update(rows.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </fieldset>
            ))}
            {!field.fixed && (!field.maxItems || rows.length < field.maxItems) && (
              <button type="button" class="btn btn-sm" onClick={() => update([...rows, blank()])}>
                Add
              </button>
            )}
          </div>
        </Wrap>
      );
    }

    case 'coursePick': {
      const ids: string[] = Array.isArray(value) ? value : [];
      const n = field.maxItems ?? 3;
      const courses = ctx.courses ?? [];
      return (
        <Wrap field={field} id={id}>
          <div class="rows">
            {Array.from({ length: n }, (_, i) => (
              <select
                aria-label={`Featured course ${i + 1}`}
                value={ids[i] ?? ''}
                onChange={(e) => {
                  const next = Array.from({ length: n }, (_, j) => ids[j] ?? '');
                  next[i] = (e.target as HTMLSelectElement).value;
                  set(field.key, next.filter(Boolean));
                }}
              >
                <option value="">— none —</option>
                {courses.map((c) => (
                  <option value={c.id}>{c.name}</option>
                ))}
              </select>
            ))}
          </div>
        </Wrap>
      );
    }
  }
}

/**
 * Starts the upload of a picture or PDF and puts its final address into the form at once (see startUpload): the admin
 * never waits on Google, and Save waits for the upload by itself. If the upload gives up, the previous value comes back.
 */
function useUploader(value: string, onChange: (v: string) => void) {
  const [status, setStatus] = useState<'' | 'uploading' | 'done'>('');
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  function begin(folder: string, filename: string, base64: string, ext: 'webp' | 'pdf') {
    const previous = value;
    const { path, done } = startUpload(folder, filename, base64, ext);
    onChange(path);
    setStatus('uploading');
    void done.then((res) => {
      if (!alive.current) return;
      if (res.ok) {
        // An older backend may have stored the file under another name: follow it, unless the admin changed the field since.
        if (res.path && res.path !== path && latest.current.value === path)
          latest.current.onChange(res.path);
        return setStatus('done');
      }
      setStatus('');
      // Put the earlier file back, unless the admin has already changed this field again in the meantime.
      const revert = latest.current.value === path;
      if (revert) latest.current.onChange(previous);
      toast(
        `The file could not be uploaded (${res.error || 'unknown error'}).${revert ? ' The previous one was kept.' : ''} Please try again.`,
        'error',
        9000,
      );
    });
    return path;
  }
  return { status, begin };
}

function UploadStatus({ status }: { status: '' | 'uploading' | 'done' }) {
  if (!status) return null;
  return (
    <span class="help" role="status" data-upload={status}>
      {status === 'uploading'
        ? 'Uploading in the background. You can keep editing; Save waits for it.'
        : '✓ Uploaded.'}
    </span>
  );
}

function ImageField({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: Field;
  value: string;
  onChange: (v: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const [missing, setMissing] = useState(false);
  const { status, begin } = useUploader(value, onChange);
  useEffect(() => setMissing(false), [value]);
  const working = Boolean(busy) || status === 'uploading';
  async function pick(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      setBusy('Optimising…');
      const { base64, bytes, originalBytes, width, height } = await compressImage(
        file,
        field.maxWidth ?? 1600,
      );
      begin(field.folder ?? 'misc', file.name, base64, 'webp');
      toast(
        `Picture optimised: ${formatBytes(originalBytes)} → ${formatBytes(bytes)} (WebP, ${width}×${height}). Remember to Save.`,
        'info',
        5000,
      );
    } catch (err) {
      toast((err as Error).message, 'error', 8000);
    } finally {
      setBusy('');
    }
  }
  return (
    <div class="imgfield" data-upload={status}>
      {value && !missing ? (
        <img src={assetUrl(value)} alt="" class="imgprev" onError={() => setMissing(true)} />
      ) : (
        <div class="imgprev imgprev-empty">
          {value
            ? value.startsWith('/uploads/')
              ? 'Going live in about 2 minutes'
              : 'Could not load this picture'
            : 'No image'}
        </div>
      )}
      <div class="imgfield-actions">
        <label class="btn btn-sm" aria-disabled={working}>
          {busy ||
            (status === 'uploading' ? 'Uploading…' : value ? 'Replace image' : 'Upload image')}
          <input
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            disabled={working}
            onChange={pick}
          />
        </label>
        {value && !working && (
          <button type="button" class="btn btn-sm" onClick={() => onChange('')}>
            Remove
          </button>
        )}
        <UploadStatus status={status} />
        <span class="help">
          Resized and converted to WebP automatically. The website then makes smaller copies for
          phones.
        </span>
      </div>
    </div>
  );
}

function PdfField({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: Field;
  value: string;
  onChange: (v: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const { status, begin } = useUploader(value, onChange);
  const working = Boolean(busy) || status === 'uploading';
  async function pick(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.type !== 'application/pdf') throw new Error('Only PDF files can be uploaded here.');
      if (file.size > 5 * 1024 * 1024)
        throw new Error(
          'This PDF is over 5 MB. Compress it or share it as a Google Drive link instead.',
        );
      setBusy('Reading…');
      begin(field.folder ?? 'resources', file.name, await fileToBase64(file), 'pdf');
      toast('PDF added. Remember to Save.', 'info', 3500);
    } catch (err) {
      toast((err as Error).message, 'error', 8000);
    } finally {
      setBusy('');
    }
  }
  return (
    <div class="imgfield-actions" data-upload={status}>
      {value && (
        <a href={assetUrl(value)} target="_blank" rel="noopener noreferrer">
          {value.split('/').pop()}
        </a>
      )}
      <label class="btn btn-sm" aria-disabled={working}>
        {busy || (status === 'uploading' ? 'Uploading…' : value ? 'Replace PDF' : 'Upload PDF')}
        <input
          id={id}
          type="file"
          accept="application/pdf"
          hidden
          disabled={working}
          onChange={pick}
        />
      </label>
      {value && !working && (
        <button type="button" class="btn btn-sm" onClick={() => onChange('')}>
          Remove
        </button>
      )}
      <UploadStatus status={status} />
    </div>
  );
}
