// Saves the channel's latest videos to src/data/youtube-snapshot.json.
//
// The Home page reads the channel's public feed every time the site is built (see src/lib/youtube.ts). This saved copy
// is only the fallback for a build that cannot reach YouTube, so it never needs to be perfectly current. Refresh it now
// and then, or after changing the channel link in the settings:
//
//   npm run youtube:refresh
import { readFile, writeFile } from 'node:fs/promises';
import { loadChannelVideos, normalizeChannelUrl } from '../src/lib/youtube.ts';

const root = new URL('..', import.meta.url);
const settings = JSON.parse(
  await readFile(new URL('src/content/settings/site.json', root), 'utf8'),
);
const url = String(settings.youtube_url ?? '');
const { videos, channelId, fresh } = await loadChannelVideos(url, undefined);
if (!fresh) {
  console.error(`Could not read the YouTube feed for "${url}". Nothing was changed.`);
  process.exit(1);
}
const snapshot = { source: normalizeChannelUrl(url), channelId, videos };
await writeFile(
  new URL('src/data/youtube-snapshot.json', root),
  `${JSON.stringify(snapshot, null, 2)}\n`,
);
const shorts = videos.filter((v) => v.short).length;
console.log(
  `Saved ${videos.length} videos (${videos.length - shorts} regular, ${shorts} Shorts) for ${channelId}.`,
);
