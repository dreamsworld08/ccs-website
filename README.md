# Chandigarh Civil Services (CCS) website

An informational, mobile-first site for a coaching institute: courses, teachers, results, free resources, exam
updates, campaign landing pages, site search, and a shared enquiry form. Staff edit the content and track enquiries
from a plain password-protected admin at `/admin/`. There is no checkout and no student login.

- **Public site:** Astro (static output) + Tailwind CSS + TypeScript, with a few small Preact islands (forms, popup,
  search, admin). System fonts only, so there is nothing to download before text appears.
- **Hosting:** one GitHub repository served by GitHub Pages (free), first on `github.io`, later on the client's domain.
- **Backend:** one Google Apps Script (keep it in the developer's own Google account, see
  [SETUP.md](google-apps-script/SETUP.md)). It stores enquiries in a Google Sheet, checks admin logins and saves content
  edits to GitHub, so staff never need a GitHub account.
- **Who can change what:** the layout, pages and features are code, changed only by the developer through git. Staff in
  `/admin/` can change **content only**, and the backend enforces that (see [SECURITY.md](SECURITY.md)).

## Quick start (local)

Requires Node 22.12 or newer.

```bash
npm install
npm run dev
```

| What          | Where                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| Website       | <http://localhost:4321>                                                |
| Admin         | <http://localhost:4321/admin/>                                         |
| Local backend | <http://localhost:8787> (stand-in for Google Apps Script, same API)    |
| Admin login   | `admin.ccs.chandigar` / `Admin@12345` (local only; see the note below) |

`npm run dev` starts both servers. In local mode:

- enquiries are saved to `dev-server/data/enquiries.json` (git-ignored; 28 demo rows are created on first start,
  delete the file to reset),
- content edits and image uploads from `/admin` are written straight into `src/content/` and `public/uploads/`, so
  the site updates immediately,
- the first start generates a signing secret in `dev-server/data/.secret` (git-ignored). The local backend has one
  throw-away login (`admin.ccs.chandigar` / `Admin@12345`, or the password in `DEV_ADMIN_PASSWORD`) that exists only on your
  computer. **Production has its own fixed logins** in `CONFIG.ADMINS` in `google-apps-script/Code.gs` (below).

Stop everything with `Ctrl+C`, then `npx astro dev stop` if the site server is still running in the background.

## How it fits together

```
Visitor's phone ──► GitHub Pages (static HTML/CSS/JS built by Astro)
       │
       │  enquiry form / popup / exam-update sign-up   (POST, form-encoded, no CORS preflight)
       ▼
Google Apps Script web app ──► Google Sheet  "CCS Enquiries"  (Enquiries · Summary · Admins)
       ▲
       │  admin login (email-or-username + password) → signed 12-hour token
Admin panel /admin/ ── list/update enquiries
       │
       └─ save content / upload image ─► Apps Script ─► GitHub Contents API commit to `main`
                                                         └► GitHub Actions rebuilds + redeploys (~1-2 min)
```

**How a content edit goes live.** The admin sends the edited JSON to Apps Script (`saveContent`) together with the
file's current `sha`. Apps Script commits it to `main` through the GitHub API using a token that lives only in
Script Properties. The push triggers the deploy workflow, and the new build is live in about two minutes. If two
people edit the same item, the second save is rejected with a conflict and the latest version is loaded. The admin
also watches `/build.json` to confirm the new build.

**The live Instagram feed** is the one thing that is _not_ built into the static site: the Home page asks Apps Script
(`instagramFeed`, cached 15 minutes) for the latest posts when the page is idle and draws them in the browser. See
[Live Instagram feed](#live-instagram-feed).

**Secrets** (`GITHUB_TOKEN`, `GITHUB_REPO`, `SIGNING_SECRET`, the Instagram access token) live only in Apps Script. The Apps Script URL in
`src/config/backend.ts` is public by design; every admin action needs a valid token.

## Content

All editable content is JSON in `src/content/`, validated by Zod schemas (`src/content.config.ts`) and
pre-rendered at build time. **Everything is edited from `/admin/`**; see [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

**The admin edits content, never layout.** The backend keeps only the fields the admin forms show, checks every value
(length, options, links, upload paths, list sizes), keeps developer-only switches such as `show_free_tests` as they are
stored, and refuses to delete or copy `settings/site.json` and `home/home.json`. The rules are generated from
`src/admin/schemas.ts`: after changing it run `npm run rules` (the deploy workflow fails if you forget). To add a new
field or section you change code, and the backend refuses it until you do.

| Folder                 | What                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `settings/site.json`   | Contact details, social links, attempt years (+ the developer-only `show_free_tests` switch)                                  |
| `home/home.json`       | Hero (video or poster, search bar text, stat tiles; hero text is saved but not shown), founder message, featured courses, CTA |
| `courses/*.json`       | Thumbnail, name, price (+ category and order set on add)                                                                      |
| `teachers/*.json`      | Name, subject, credential, bio, photo, intro video                                                                            |
| `results/*.json`       | Student, exam, year, rank, photo, "show on home"                                                                              |
| `reels/*.json`         | Instagram reel testimonials: link, student, rank label, cover picture                                                         |
| `resources/*.json`     | Free resources (uploaded PDF **or** external link)                                                                            |
| `exam-updates/*.json`  | Date, exam body, category, title, official link                                                                               |
| `landing-pages/*.json` | Campaign pages (`/lp/<slug>/`); only **published** ones are built                                                             |
| `tests/*.json`         | Free tests (hidden until the developer sets `show_free_tests` to `true` in `settings/site.json`)                              |

Seed entries carry `"dummy": true` and show a **Sample** badge in the admin. Images live in `public/uploads/`.

## Pictures

Staff upload **one** picture; the site then serves each phone a copy sized for its screen, in the smallest format it
understands.

1. **In the admin, before upload:** the browser scales the picture down to the field's limit (900 to 1600 px wide), re-encodes
   it as **WebP** (which also removes EXIF data such as GPS location) and lowers the quality until it is under about
   300 KB. The admin shows `2.4 MB → 86 KB`, and previews the picture immediately.
2. **At build time:** `scripts/lib/optimize-uploads.mjs` writes WebP and **AVIF** copies at 400, 640, 960 and 1280 px
   (only the sizes the upload is wider than) into `dist/`. Nothing derived is committed to git.
3. **On the page:** `src/components/Img.astro` renders a `<picture>` with `srcset` and `sizes`, so the browser downloads
   the smallest file that is sharp on its screen (in a test, a 56 KB hero poster became 24 KB on a 2x phone). Browsers
   without AVIF get WebP; very old ones get the original. Pictures are lazy-loaded and keep their size in the page,
   so nothing jumps; the hero poster loads first.

SVG artwork, PDFs and files that are not uploaded WebP are served as they are. `npm run test:images` tests the pipeline;
`npm run prune:uploads` lists uploads that no page uses any more (replaced pictures stay on GitHub and on the live site
until you delete them).

## Site search

The search bar on the bottom edge of the Home hero and the magnifier in the navigation bar (or press `/`) search **free resources, exam updates and results** as you
type. On very small phones (under 360px wide) the search box is inside the menu. `Enter` opens a full results page
at `/search/?q=...`.

- The index (`/search-index.json`) is generated at build time from **published** content only, so unpublishing
  something removes it from search with the next build. It is downloaded once, the first time search is opened.
- Matching is prefix-based, ranks title matches first, and understands friendly aliases ("pyq" finds "previous
  year", "hall ticket" finds admit cards). See `src/pages/search-index.json.ts` and `src/lib/search.ts`.
- Result rows open the resource or official link in a new tab; student results open `/results/?q=<name>`.

## Topper reels (Instagram carousel)

A swipeable row of 9:16 reel cards in the middle of the Home page (between Free Resources and Exam Updates) and on
the Results page. Manage it in **Admin > Reels**: paste the reel's Instagram link, the student, a rank label and a cover picture.

- **The cards show the real reel without a tap.** Each non-sample card embeds Instagram's own preview, scaled and
  cropped to the card (a 9:16 reel fits exactly; a photo post is cropped to fill it). It is display-only: swiping scrolls
  the carousel and a tap opens the player. The preview is a full Instagram embed (about 3 MB for the first one, less
  for the rest), so it is **lazy**: nothing is requested until the carousel is within a screen of the viewport, then
  only for cards that are (nearly) visible, and never on data-saver or 2G/3G connections, where the cover picture is
  shown instead. Sample reels (marked **Sample**) are never previewed, because their placeholder codes would show
  Instagram's "link may be broken" panel. See `src/components/ReelsCarousel.astro`.
- A **cover picture** is still worth uploading (a screenshot works): it is what shows on data-saver connections and
  while the preview loads. Instagram offers no public thumbnails, so it cannot be fetched automatically.
- **Tapping a card** opens a native dialog with Instagram's player (with sound) in a sandboxed frame, plus an
  "Open on Instagram" link. Closing it removes the frame, which stops playback.
- Only the shortcode of the link is used (`src/lib/site.ts`, `instagramRef`); the embed address is rebuilt from it, so
  nothing else typed into the admin can reach a frame. Cards with an unusable link are not shown.
- The Instagram account must be **public** and allow embedding. The seeded sample reels use placeholder codes, so
  their player shows Instagram's "link may be broken" notice until you replace them.

## Live Instagram feed

The Home page can show the institute's newest Instagram photos and reels as a swipeable row ("Latest from our Instagram",
right after the topper reels). It is separate from the hand-picked **Reels** tab and appears only when an admin has
connected an account and switched it on; otherwise the section is simply not on the page.

**How it works**

```
Admin > Instagram ──paste token──► Apps Script (Script Properties: IG_TOKEN, never sent back to any browser)
                                        │  GET graph.instagram.com/me/media   (cached 15 min, last good copy kept 6 h)
Home page (idle) ──instagramFeed──►─────┘  returns only sanitised posts: picture URL, post link, 140-char caption, date
```

- **API:** "Instagram API with Instagram Login" (the replacement for the Basic Display API, which Meta shut down in
  Dec 2024). The account must be a **Business or Creator** account. The admin pastes a long-lived access token made in
  the Meta developer dashboard; the tab explains the steps in plain words.
- **Renewal:** a long-lived token lasts 60 days. The backend renews it by itself (once it is 10 days old) while visitors
  use the site, so nothing needs doing unless the site gets no visits for ~50 days. The admin tab shows the days left.
- **Live, not rebuilt:** connecting, switching on/off, the heading and the number of posts (3-12) are stored in the
  backend, so they apply at once. New Instagram posts show within about 15 minutes. No GitHub commit, no redeploy.
- **Failure is quiet:** if Instagram is down the last good copy is served (up to 6 hours); with nothing cached the
  section stays hidden. After a failed request the backend leaves Instagram alone for 2 minutes.
- **Safety:** the token never leaves Apps Script and is never logged. The backend only passes on posts whose link is an
  `instagram.com` post and whose picture is on Instagram's own CDN (`*.cdninstagram.com`, `*.fbcdn.net`), and the page
  checks everything again; captions are inserted as plain text. Tapping a post opens the same sandboxed player as
  the reels (`src/scripts/ig-player.ts`). The Content-Security-Policy allows those two picture hosts and nothing else new.
- **Code:** `Code.gs` > "Instagram live feed", mirrored by `dev-server/server.mjs`; the page is
  `src/components/InstagramFeed.astro`; the admin screen is `src/admin/tabs/InstagramTab.tsx`.
- **Trying it without a Meta account:** in local development connect with the token `demo` (Admin > Instagram): the
  dev backend then serves sample posts and never contacts Instagram.
- **Not tested against live Instagram.** `npm run test:gs` and `npm run e2e` use a fake Instagram API, so the code is
  checked but the real service is not. Do the check in [SETUP.md](google-apps-script/SETUP.md) step 8 on the real account.

## Mobile and performance

- Mobile-first, checked for horizontal overflow at 320, 360, 375, 390, 412, 430, 768, 1024, 1280 and 1440px.
- Cards are compact on phones: course and teacher cards are short horizontal rows, result cards sit two across, and the
  toppers and reels are swipe rows. They grow into the large vertical cards from 768px.
- System font stacks (no web fonts), native `<dialog>` for the popup (a bottom sheet on phones), native `<details>`
  for FAQs and optional form fields, CSS scroll-snap carousel, one tiny filter script shared by four pages.
- The hero is the video and nothing else: a full-width 16:9 panel with no dark tint and no text or buttons on top
  (the headline stays as a visually hidden `<h1>` for search engines and screen readers; the text fields remain in the
  admin and are drawn only if you remove both the video and the poster). The poster paints first; the YouTube player is
  only fetched on desktop with a good connection, or when a phone user presses Play.
- Lighthouse (mobile, simulated 4G): Performance, Accessibility, Best Practices and SEO all 100 on Home and a
  landing page (measured before the responsive-picture work; re-run it after adding real photos).
- Right-click and image dragging are disabled on the public site (`src/scripts/protect.ts`), except inside text fields so
  a phone number can be pasted. The admin is not affected. It is a deterrent against casual copying, not protection.

## Scripts

| Command                        | What it does                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `npm run dev`                  | Site + local backend together                                                             |
| `npm run dev:site` / `dev:api` | Either one on its own                                                                     |
| `npm run build`                | Production build into `dist/` (uses `SITE_URL` and `BASE_PATH` from env)                  |
| `npm run build:local`          | Production build that talks to the local backend (for testing `dist/`)                    |
| `npm run preview`              | Serve `dist/`                                                                             |
| `npm run check`                | Type-check Astro, TypeScript and content                                                  |
| `npm run lint` / `format`      | ESLint / Prettier                                                                         |
| `npm run hash -- --generate`   | Make an admin login for `CONFIG.ADMINS`: a long random password (shown once) and its hash |
| `npm run rules`                | Regenerate the backend's content lock from `src/admin/schemas.ts` (`-- --check` verifies) |
| `npm run prune:uploads`        | List uploaded files no page uses (`-- --delete` removes them)                             |
| `npm run placeholders`         | Regenerate the placeholder artwork in `public/uploads/placeholders`                       |
| `npm run brand`                | Rebuild the logo, favicon, app icons and share image from `brand/ccs-logo.png`            |
| `npm run check:layout`         | Load every page at 10 widths; fails on any horizontal overflow                            |
| `npm run e2e`                  | Browser tests of forms, popup, search, admin, uploads and security cases                  |
| `npm run test:gs`              | Runs the real `Code.gs` against in-memory fakes of Sheets/GitHub/Cache                    |
| `npm run test:images`          | Tests the responsive WebP/AVIF picture pipeline                                           |

Run the browser tests like this:

```bash
npm run dev:api                          # terminal 1
npm run build:local && npm run e2e       # terminal 2
npm run check:layout
```

`test:gs` proves the Apps Script logic (validation, auth, the content lock, stable row ids, GitHub conflicts, uploads,
admin management). It cannot prove Google's runtime accepts every call, so follow the test steps in
[SETUP.md](google-apps-script/SETUP.md) once on the real account.

## Deploy to GitHub Pages

1. Create the empty repo `ccs-website`, then push this project to `main`.
2. Repo **Settings > Pages > Build and deployment > Source: GitHub Actions.**
3. Set up the backend once with [google-apps-script/SETUP.md](google-apps-script/SETUP.md) and paste the web app URL
   into `src/config/backend.ts`. Commit and push.
4. `.github/workflows/deploy.yml` builds (after `npm run check`) and deploys on every push to `main`, including the
   commits the admin panel makes. With no repository variables set it builds for
   `https://<owner>.github.io/ccs-website/`.
5. Verify on the live URL: every page loads, a test enquiry reaches the sheet, admin login works, and a content edit
   and a landing-page publish/unpublish go live after the rebuild.

## Switch to the client's own domain

1. Add a file `public/CNAME` containing the domain, for example `www.example.in`.
2. Repo **Settings > Secrets and variables > Actions > Variables**: set `SITE_URL=https://www.example.in` and
   `BASE_PATH=/`. Push (or re-run the workflow).
3. Repo **Settings > Pages > Custom domain**: enter the domain.
4. At the registrar remove old A/CNAME records for the same names, then add:

   | Type  | Host / Name | Value                  |
   | ----- | ----------- | ---------------------- |
   | A     | `@`         | `185.199.108.153`      |
   | A     | `@`         | `185.199.109.153`      |
   | A     | `@`         | `185.199.110.153`      |
   | A     | `@`         | `185.199.111.153`      |
   | CNAME | `www`       | `<username>.github.io` |

   Email (MX records) is unaffected.

5. When DNS resolves (minutes to 24 hours), tick **Enforce HTTPS** in Pages settings and test a form and `/admin/`.

## Admins

**Who can sign in is fixed in the code**: the list `CONFIG.ADMINS` at the top of `google-apps-script/Code.gs` (name, login,
salt and the salted hash of a long random _starting_ password; never the password). There is no admin table and no way
to add, remove or reset an admin from the website, so nobody can change who may sign in except by changing that file.

- **A starting password for everyone, then their own.** The password in the code works from the first sign-in. Each admin
  then chooses their own in **Settings > Change my password** (10+ characters, a letter and a number). The chosen password
  is stored as a salted hash in Apps Script's private Script Properties (`ADMINPW_*`), never in the repository or the
  sheet, and from then on it replaces the starting one. Changing it also signs out every other open session.
- **Add a person:** `npm run hash -- --generate staff.name 'Staff Name'` prints a ready-to-paste entry and a starting
  password (shown once: save it in a password manager and hand it over privately). Paste the entry into `CONFIG.ADMINS`,
  copy `Code.gs` into Apps Script and **Deploy > Manage deployments > Edit > New version**.
- **Reset a forgotten password:** run the same command for that login and replace its salt and hash in `CONFIG.ADMINS`,
  then deploy. A password chosen earlier is ignored as soon as the hash in the code changes, so the new starting password
  works and the person changes it again.
- **Remove access:** delete the person's entry and deploy a new version. Their open sessions end at once.
- Every admin can change **content only**, never layout or features, and each change shows who made it ("Updated by").
- The repository is public, so the _starting_ hashes are public: only use passwords from `--generate` (20 random
  characters) or at least 16 random characters. A short or guessable one could be cracked offline; `npm run hash` refuses
  them. Passwords an admin chooses are private, so they only need to be good, not 16+ characters.
- Locally the one dev login lives in `dev-server/server.mjs` (a change-password there lasts until the server restarts).

## Before launch checklist

- [x] Logo, favicon and share image are in (made from `brand/ccs-logo.png` by `npm run brand`). To change the logo, replace
      that file and run `npm run brand`; `brand/ccs-logo.svg` is the supplied vector trace, kept as an archive.
- [ ] Optional: connect the institute's Instagram account in **Admin > Instagram** for the live feed on the Home page.
- [ ] Replace the sample content (everything marked **Sample** in the admin): contact details, stats, founder
      message, teachers, results, hero video (the seeded video is only a placeholder).
- [ ] Set up the backend ([SETUP.md](google-apps-script/SETUP.md)), save the admin password somewhere safe, and work through
      "Do this before going live" in [SECURITY.md](SECURITY.md) (script in your own Google account, two-factor
      authentication, token expiry).
- [ ] Add each real staff member with `npm run hash -- --generate` (see "Admins"); share the enquiry sheet only as **Viewer** (or not at all).
- [ ] Review the Privacy Policy text with the institute. The enquiry form says submitting means agreeing to be contacted.
- [ ] Upload the real photos in the admin, then run `npm run prune:uploads` to drop anything unused.

## Project layout

```
astro.config.mjs        site/base from env, sitemap, Content-Security-Policy
brand/                  the logo artwork (source of every logo/favicon file) and the share-card base
src/pages/              public routes, /admin/, /lp/[slug]/, /search/, robots, build.json, search-index.json
src/components/         Astro components (navbar, footer, cards, sections)
src/islands/            Preact islands: enquiry form, popup, search, countdown, sign-up
src/admin/              the admin app (Preact), plain CSS
src/lib/                site helpers (base path, safe links), API client, search, enquiry logic
src/content/            JSON content (edited via /admin)
google-apps-script/     Code.gs, appsscript.json, SETUP.md  (production backend); content-lock.mjs, content-rules.json (the lock)
dev-server/             local stand-in for the Apps Script backend
scripts/                dev runner, QA scripts (layout, e2e, Code.gs and image tests), placeholders, brand files, hashing, lock generator
scripts/lib/            responsive-picture build step and its recipe
.github/workflows/      build + deploy to GitHub Pages
```

## Known limits

- GitHub Pages cannot send HTTP security headers, so the Content-Security-Policy ships as a `<meta>` tag and
  `frame-ancestors` is replaced by a script guard in the admin. See [SECURITY.md](SECURITY.md).
- The admin converts images to WebP in the browser; use Chrome, Edge or Firefox for uploads. AVIF copies are made by the
  build, so no browser support is needed for them on the admin side.
- The backend checks every content save against the admin schema, so a hand-made request cannot break the build; if
  anything unexpected still does, the previous site stays live (`npm run check` runs before every deploy).
- A student's year of attempt is optional on the form, so some enquiries have none: the admin shows "Not given" and the
  Summary sheet has a "No year" column.
