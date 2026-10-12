// The YouTube videos on the Home page (src/lib/youtube.ts): reading the channel feed, cleaning titles, choosing which
// videos to show, and what happens when YouTube cannot be reached. No network needed.
//   npm run test:youtube
import {
  channelIdFromPage,
  channelIdFromUrl,
  cleanTitle,
  formatDate,
  loadChannelVideos,
  normalizeChannelUrl,
  parseFeed,
  pickVideos,
  thumb,
  VIDEO_ID,
} from '../src/lib/youtube.ts';

let pass = 0;
let fail = 0;
const check = (cond, name, extra = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` ${extra}`}`);
};

const CHANNEL = 'UCTtSJC7F8XIeSrMaQy-R7Gw';
const entry = (id, title, published, short = false) => `
  <entry>
    <id>yt:video:${id}</id>
    <yt:videoId>${id}</yt:videoId>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/${short ? 'shorts/' : 'watch?v='}${id}"/>
    <published>${published}</published>
  </entry>`;
const FEED = `<?xml version="1.0"?><feed>${[
  entry('AAAAAAAAAA1', 'Newest short #upsc #news', '2026-10-12T11:48:16+00:00', true),
  entry('AAAAAAAAAA2', 'Democracy &amp; Diversity #ccsacademy', '2026-10-06T10:00:00+00:00'),
  entry('AAAAAAAAAA3', 'Topic: CYTOLOGY', '2026-10-07T13:00:09+00:00'),
  entry('AAAAAAAAAA4', 'Older lecture', '2026-09-01T08:00:00+00:00'),
].join('')}</feed>`;

console.log('titles');
check(
  cleanTitle('Right to protest | sc judgement &amp; case #ccsacademy #upsc') ===
    'Right to protest | sc judgement & case',
  'hashtags are dropped and &amp; is decoded',
);
check(
  cleanTitle('BOOSTER (45 days)#hpgk #crashcourse e') === 'BOOSTER (45 days) e',
  'a hashtag glued to the previous word is dropped too',
);
check(
  cleanTitle('C# programming in &#39;Hindi&#39; &quot;batch&quot;') ===
    'C# programming in \'Hindi\' "batch"',
  'a "#" that is not a hashtag stays; numeric and named entities decode',
);
check(
  cleanTitle('#only #hashtags') === '#only #hashtags',
  'a title that is nothing but hashtags is kept as it was',
);
check(cleanTitle('x'.repeat(300)).length === 120, 'a very long title is cut to 120 characters');
check(cleanTitle('A\u0000B\nC') === 'A B C', 'control characters become spaces');
check(
  cleanTitle('&#99999999999;&lt;b&gt;') === '<b>',
  'an impossible numeric entity is dropped, never thrown on',
);

console.log('\nreading the feed');
const parsed = parseFeed(FEED);
check(parsed.length === 4, 'all four entries are read');
check(
  parsed.map((v) => v.id).join() === 'AAAAAAAAAA1,AAAAAAAAAA3,AAAAAAAAAA2,AAAAAAAAAA4',
  'sorted newest first by publish time, whatever order the feed lists them',
);
check(
  parsed[0].short === true && parsed[1].short === false,
  'Shorts are told apart by their /shorts/ link',
);
check(parsed[2].title === 'Democracy & Diversity', 'titles come out clean');
const hostile = parseFeed(
  `<feed>${[
    entry('short', 'bad id', '2026-10-01T00:00:00+00:00'),
    entry('"><script>x</script>', 'injected id', '2026-10-01T00:00:00+00:00'),
    entry('BBBBBBBBBB1', 'no date', ''),
    entry('BBBBBBBBBB2', '   ', '2026-10-01T00:00:00+00:00'),
    entry('BBBBBBBBBB3', 'fine', '2026-10-01T00:00:00+00:00'),
  ].join('')}</feed>`,
);
check(
  hostile.length === 1 && hostile[0].id === 'BBBBBBBBBB3',
  'entries with a malformed id, no date or no title are skipped',
);
check(
  parseFeed('not xml at all').length === 0 && parseFeed('').length === 0,
  'rubbish gives an empty list, not an error',
);
check(
  VIDEO_ID.test('o7Hgh5UaIc4') &&
    !VIDEO_ID.test('o7Hgh5UaIc') &&
    !VIDEO_ID.test('o7Hgh5UaIc4x') &&
    !VIDEO_ID.test('o7Hgh5Ua/c4'),
  'only an 11-character id is accepted',
);

console.log('\nchoosing what to show');
const many = Array.from({ length: 15 }, (_, i) => ({
  id: `V${String(i).padStart(10, '0')}`,
  title: `v${i}`,
  published: `2026-10-${String(20 - i).padStart(2, '0')}T00:00:00+00:00`,
  short: i % 3 === 0,
}));
check(
  pickVideos(many, { count: '8', shorts: false }).every((v) => !v.short),
  'Shorts are left out unless asked for',
);
check(pickVideos(many, { count: '8', shorts: false }).length === 8, 'the count is honoured (8)');
check(
  pickVideos(many, { count: '4', shorts: true }).length === 4 &&
    pickVideos(many, { count: '4', shorts: true })[0].short,
  'with Shorts on they are included, newest first',
);
check(pickVideos(many, { count: '1', shorts: true }).length === 3, 'never fewer than 3 cards');
check(
  pickVideos(many, { count: '99', shorts: true }).length === 15,
  'never more than the feed holds (15)',
);
check(
  pickVideos(many, { count: 'banana', shorts: true }).length === 8,
  'an unreadable count falls back to 8',
);
check(pickVideos([], { count: '8', shorts: false }).length === 0, 'no videos gives an empty list');

console.log('\nsmall helpers');
check(
  formatDate('2026-10-12T23:30:00+00:00') === '13 Oct 2026',
  'dates are shown in Indian time (a 5 AM IST upload keeps its day)',
  formatDate('2026-10-12T23:30:00+00:00'),
);
check(formatDate('garbage') === '', 'a bad date shows nothing');
check(
  thumb('abcdefghijk', 'mq') === 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg',
  'thumbnail address',
);
check(
  normalizeChannelUrl(' http://youtube.com/@CCSAcademy7900/ ') ===
    'https://www.youtube.com/@ccsacademy7900',
  'the channel link is normalised so the saved copy can be matched',
);
check(
  channelIdFromUrl(`https://www.youtube.com/channel/${CHANNEL}`) === CHANNEL &&
    channelIdFromUrl('https://www.youtube.com/@x') === null,
  'a /channel/UC... link carries its own id',
);
check(
  channelIdFromPage(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL}">`) ===
    CHANNEL,
  'the id is found in a channel page (canonical link)',
);
check(channelIdFromPage(`..."externalId":"${CHANNEL}"...`) === CHANNEL, '...or in its page data');
check(channelIdFromPage('<html>nothing</html>') === null, '...and a page without one gives null');

console.log('\nreading the channel, and falling back');
const HANDLE = 'https://www.youtube.com/@ccsacademy7900';
const snapshot = {
  source: normalizeChannelUrl(HANDLE),
  channelId: CHANNEL,
  videos: parsed.slice(1, 3),
};
const calls = [];
const respond = (routes) => async (url) => {
  calls.push(url);
  for (const [match, res] of routes)
    if (url.includes(match)) return typeof res === 'function' ? res() : res;
  throw new Error('no route');
};
const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const warn = console.warn;
console.warn = () => {};

let r = await loadChannelVideos(HANDLE, snapshot, respond([['feeds/videos.xml', ok(FEED)]]));
check(
  r.fresh && r.videos.length === 4 && calls.length === 1 && calls[0].endsWith(CHANNEL),
  'with a saved copy for this channel, only the feed is fetched (the channel page is not scraped)',
);

calls.length = 0;
r = await loadChannelVideos(
  HANDLE,
  undefined,
  respond([
    [
      '@ccsacademy7900',
      ok(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL}">`),
    ],
    ['feeds/videos.xml', ok(FEED)],
  ]),
);
check(
  r.fresh && r.channelId === CHANNEL && calls.length === 2,
  'without a saved copy the channel page gives the id, then the feed is read',
);

r = await loadChannelVideos(
  HANDLE,
  snapshot,
  respond([['feeds/videos.xml', { ok: false, status: 500, text: async () => '' }]]),
);
check(
  !r.fresh && r.videos.length === 2 && r.channelId === CHANNEL,
  'YouTube answering 500 falls back to the saved copy',
);

r = await loadChannelVideos(HANDLE, snapshot, respond([]));
check(!r.fresh && r.videos.length === 2, 'no network falls back to the saved copy');

r = await loadChannelVideos(HANDLE, snapshot, respond([['feeds/videos.xml', ok('<feed></feed>')]]));
check(
  !r.fresh && r.videos.length === 2,
  'an empty feed is treated as a failure, not as "the channel has no videos"',
);

r = await loadChannelVideos('https://www.youtube.com/@someone-else', snapshot, respond([]));
check(!r.fresh && r.videos.length === 0, 'a saved copy for a DIFFERENT channel is never shown');

r = await loadChannelVideos(
  'https://example.com/not-youtube',
  snapshot,
  respond([['feeds/videos.xml', ok(FEED)]]),
);
check(
  !r.fresh && r.videos.length === 0,
  'a link that is not YouTube shows nothing and fetches nothing',
);

calls.length = 0;
r = await loadChannelVideos('', snapshot, respond([['feeds/videos.xml', ok(FEED)]]));
check(
  !r.fresh && r.videos.length === 0 && calls.length === 0,
  'an empty link shows nothing and fetches nothing',
);

r = await loadChannelVideos(
  `https://www.youtube.com/channel/${CHANNEL}`,
  undefined,
  respond([['feeds/videos.xml', ok(FEED)]]),
);
check(r.fresh && r.videos.length === 4, 'a /channel/UC... link needs no page lookup at all');
console.warn = warn;

console.log(`\n${fail ? 'FAILED' : 'PASSED'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
