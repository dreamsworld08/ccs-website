/**
 * Whether the Home hero draws its welcome line, headline, sub-text and buttons.
 *
 * The admin chooses (Home Page > Hero > "Text on the hero"):
 *   Automatic     a VIDEO plays clean, with nothing on top of it; with only a picture (or nothing at all) the text is
 *                 shown on a dark tint so it can be read. This is the default.
 *   Always show   the text is shown over a video or a picture too.
 *   Always hide   only the video or picture is shown.
 * The headline stays in the page as a visually hidden <h1> whenever the text is hidden, so search engines and
 * screen readers still get it.
 */
export const HERO_TEXT_MODES = ['Automatic', 'Always show', 'Always hide'] as const;

export function heroShowsText(mode: string | undefined | null, hasVideo: boolean): boolean {
  if (mode === 'Always show') return true;
  if (mode === 'Always hide') return false;
  return !hasVideo;
}
