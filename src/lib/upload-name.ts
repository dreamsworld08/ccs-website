/**
 * Names for files the admin uploads. The BROWSER picks the name (the server only checks it), so the picture's address
 * is known before the upload finishes: the form can use it at once, and a repeated upload (after Google lost the
 * answer) is the same file under the same name, which the server accepts as "already done" instead of storing a copy.
 *
 * Shape: <slug>-<13-digit time>.<webp|pdf>, for example amit-sharma-1791803973009.webp.
 * google-apps-script/Code.gs (UPLOAD_NAME_RE) and dev-server/server.mjs apply the same rule.
 */
export const UPLOAD_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{13}\.(webp|pdf)$/;

export function uploadName(filename: string, ext: 'webp' | 'pdf', now = Date.now()): string {
  const slug =
    filename
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'file';
  return `${slug}-${now}.${ext}`;
}
