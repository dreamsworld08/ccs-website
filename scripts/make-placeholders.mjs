// Generates the dummy SVG artwork used by the seed content.
// Run: npm run placeholders   (safe to re-run; real uploads are never touched)
import { mkdirSync, writeFileSync } from 'node:fs';

const dir = 'public/uploads/placeholders';
mkdirSync(dir, { recursive: true });
const write = (name, svg) => writeFileSync(`${dir}/${name}`, svg.trim() + '\n');

const palettes = [
  ['#DFF6E2', '#1F8A3B'],
  ['#ECEAFE', '#6047FF'],
  ['#EBF6FF', '#0042F6'],
  ['#F5E9D8', '#B26A1B'],
  ['#FEEEEA', '#E24A1F'],
  ['#EDF0F5', '#3B4256'],
  ['#E7F5F2', '#0F8A78'],
  ['#F3E8FA', '#8A3DB5'],
];

// Neutral person silhouettes (4:5), used for teachers, toppers and the founder.
palettes.forEach(([bg, fg], i) => {
  write(
    `person-${i + 1}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750" role="img" aria-label="Placeholder portrait">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#ffffff" stop-opacity=".6"/></linearGradient></defs>
  <rect width="600" height="750" fill="url(#g)"/>
  <circle cx="300" cy="290" r="108" fill="${fg}" opacity=".92"/>
  <path d="M60 750C60 566 168 462 300 462s240 104 240 288z" fill="${fg}" opacity=".92"/>
  <path d="M236 470l64 70 64-70" fill="none" stroke="${bg}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>
</svg>`,
  );
});

// Course thumbnails (16:10) with different geometric motifs.
const motifs = [
  (fg) =>
    `<circle cx="470" cy="120" r="150" fill="${fg}" opacity=".18"/><circle cx="470" cy="120" r="90" fill="${fg}" opacity=".35"/><rect x="60" y="220" width="220" height="24" rx="12" fill="${fg}" opacity=".5"/><rect x="60" y="262" width="150" height="24" rx="12" fill="${fg}" opacity=".3"/>`,
  (fg) =>
    `<g fill="${fg}" opacity=".35">${Array.from({ length: 6 }, (_, k) => `<rect x="${70 + k * 82}" y="${250 - k * 28}" width="56" height="${100 + k * 28}" rx="14"/>`).join('')}</g>`,
  (fg) =>
    `<path d="M0 300C120 220 220 380 340 290S520 200 640 280V400H0z" fill="${fg}" opacity=".3"/><path d="M0 340C140 280 240 400 360 330S540 260 640 320V400H0z" fill="${fg}" opacity=".45"/><circle cx="130" cy="110" r="46" fill="${fg}" opacity=".5"/>`,
  (fg) =>
    `<g stroke="${fg}" stroke-width="10" opacity=".35" fill="none"><circle cx="320" cy="200" r="150"/><circle cx="320" cy="200" r="100"/><circle cx="320" cy="200" r="50"/></g>`,
  (fg) =>
    `<g fill="${fg}" opacity=".35">${Array.from({ length: 5 }, (_, r) => Array.from({ length: 9 }, (_, c) => `<circle cx="${70 + c * 62}" cy="${80 + r * 62}" r="${6 + ((r + c) % 3) * 3}"/>`).join('')).join('')}</g>`,
  (fg) =>
    `<path d="M60 330L200 120l120 140 80-90 180 160z" fill="${fg}" opacity=".4"/><circle cx="500" cy="90" r="42" fill="${fg}" opacity=".55"/>`,
];
motifs.forEach((m, i) => {
  const [bg, fg] = palettes[i];
  write(
    `course-${i + 1}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="Placeholder course thumbnail">
  <rect width="640" height="400" fill="${bg}"/>${m(fg)}
</svg>`,
  );
});

// Instagram reel covers (9:16): soft gradient with a silhouette. Replace with real reel screenshots in /admin.
palettes.slice(0, 6).forEach(([bg, fg], i) => {
  write(
    `reel-${i + 1}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640" role="img" aria-label="Placeholder reel cover">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${fg}" stop-opacity=".55"/></linearGradient></defs>
  <rect width="360" height="640" fill="url(#g)"/>
  <circle cx="180" cy="270" r="74" fill="${fg}" opacity=".9"/>
  <path d="M40 640C40 480 100 392 180 392s140 88 140 248z" fill="${fg}" opacity=".9"/>
</svg>`,
  );
});

// Hero poster (16:9) and generic content image.
write(
  'hero-poster.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Placeholder hero poster">
  <defs>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A1B5C"/><stop offset=".55" stop-color="#0042F6"/><stop offset="1" stop-color="#6047FF"/></linearGradient>
    <radialGradient id="b" cx=".78" cy=".2" r=".6"><stop offset="0" stop-color="#FFB41F" stop-opacity=".55"/><stop offset="1" stop-color="#FFB41F" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#a)"/><rect width="1600" height="900" fill="url(#b)"/>
  <g fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"><circle cx="1200" cy="320" r="220"/><circle cx="1200" cy="320" r="340"/><circle cx="1200" cy="320" r="460"/></g>
</svg>`,
);
write(
  'generic.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="Placeholder image"><rect width="640" height="400" fill="#EDF0F5"/><path d="M200 280l80-100 60 70 40-50 80 80z" fill="#C7CEDB"/><circle cx="250" cy="150" r="28" fill="#C7CEDB"/></svg>`,
);

console.log('Placeholders written to', dir);
