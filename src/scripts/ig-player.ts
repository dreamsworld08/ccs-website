/**
 * The popup that plays (reels) or shows (photos) one Instagram post. Shared by the "Toppers speak" reels and
 * the live Instagram feed so both open posts the same, safe way:
 *   - the iframe address is rebuilt here from a validated post type and shortcode, never taken from the page
 *   - the iframe is sandboxed (no navigation of the site), and removed again on close, which stops playback
 *     and any network activity.
 * The dialog needs: [data-reel-frame], [data-reel-title], [data-reel-link] and [data-reel-close].
 */
export function setupPlayer(dialog: HTMLDialogElement) {
  const wrap = dialog.querySelector<HTMLElement>('[data-reel-frame]')!;
  const title = dialog.querySelector<HTMLElement>('[data-reel-title]')!;
  const link = dialog.querySelector<HTMLAnchorElement>('[data-reel-link]')!;

  dialog.addEventListener('close', () => wrap.replaceChildren());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.querySelector('[data-reel-close]')?.addEventListener('click', () => dialog.close());

  return function open(kind: string, code: string, heading: string, frameTitle: string) {
    if (!/^[\w-]{5,20}$/.test(code) || !/^(reel|p|tv)$/.test(kind)) return;
    const frame = document.createElement('iframe');
    frame.src = `https://www.instagram.com/${kind}/${code}/embed/`;
    frame.title = frameTitle;
    frame.className = 'reel-frame';
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation',
    );
    wrap.replaceChildren(frame);
    title.textContent = heading;
    link.href = `https://www.instagram.com/${kind}/${code}/`;
    dialog.showModal();
  };
}
