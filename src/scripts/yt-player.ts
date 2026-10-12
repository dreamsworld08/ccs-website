/**
 * The popup that plays one YouTube video on the Home page. The iframe address is rebuilt here from a validated
 * 11-character video id (never taken from the page), uses YouTube's no-cookie host, is sandboxed, and is removed again
 * when the popup closes, which stops playback and any network use.
 * The dialog needs: [data-yt-frame], [data-yt-title], [data-yt-link] and [data-yt-close].
 */
const VIDEO_ID = /^[\w-]{11}$/;

export function setupYouTubePlayer(dialog: HTMLDialogElement) {
  const wrap = dialog.querySelector<HTMLElement>('[data-yt-frame]')!;
  const title = dialog.querySelector<HTMLElement>('[data-yt-title]')!;
  const link = dialog.querySelector<HTMLAnchorElement>('[data-yt-link]')!;

  dialog.addEventListener('close', () => wrap.replaceChildren());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.querySelector('[data-yt-close]')?.addEventListener('click', () => dialog.close());

  return function open(id: string, heading: string) {
    if (!VIDEO_ID.test(id)) return;
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;
    frame.title = heading;
    frame.className = 'yt-frame';
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation',
    );
    wrap.replaceChildren(frame);
    title.textContent = heading;
    link.href = `https://www.youtube.com/watch?v=${id}`;
    dialog.showModal();
  };
}
