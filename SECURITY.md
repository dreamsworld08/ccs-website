# Security review

Scope: this is a mostly static site that collects enquiries and has a small password-protected admin. The goal of this
review was to find ways to **break it** (take over the admin, inject content or scripts, corrupt or leak enquiry data,
deface the site, abuse the forms), without adding heavy machinery. Nothing here needs encryption beyond HTTPS, which
GitHub Pages provides.

Reviewed: the public site, the admin app, the local backend (`dev-server/server.mjs`) and the production backend
(`google-apps-script/Code.gs`), the build and deploy configuration, and the dependencies.

## Who can change what

The website has three kinds of people, and the code enforces the boundary between them on the **server**, not just
in the admin screens:

| Who               | Can change                                                                                           | Cannot change                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Developer**     | Everything: layout, pages, menus, features, switches, the backend, the deploy (through git/GitHub)   | n/a                                               |
| **Admin (staff)** | Content only: text, prices, pictures, links, videos, results, exam updates; enquiry status and notes | Layout, page structure, features, scripts, styles |
| **Visitor**       | Nothing. They can only send the enquiry forms                                                        | Everything else                                   |

How the "content only" rule is enforced (`google-apps-script/content-lock.mjs`, used by `Code.gs` and the local
backend, generated from the same field list that draws the admin forms in `src/admin/schemas.ts`):

- **Only declared fields are stored.** Any other key in a save request (a layout option, CSS, HTML, a script) is dropped.
- **Every value is checked** on the server: type, length, allowed options, link schemes (`javascript:` is refused),
  upload paths (only `/uploads/...`), dates, and list sizes (for example at most 3 tick points on a landing page).
- **Developer-only switches keep their stored value.** `show_free_tests` (it adds a whole page and a menu link) is not in
  any admin form, and a request that tries to change it is ignored. Only editing the file in git changes it.
- **Choices made once stay made:** a course's category and a landing page's address cannot be changed afterwards.
- **`settings/site.json` and `home/home.json` are single files.** They cannot be deleted (the site could not be built
  without them) or copied under another name.
- **Everything else is already closed:** admins can only touch `src/content/<folder>/<name>.json` and
  `public/uploads/`, and only WebP pictures and PDFs can be uploaded.

Adding a field or a new kind of content is therefore a code change: edit `src/admin/schemas.ts`, run
`npm run rules`, and deploy. Until then the backend refuses it, even from a hand-made request.

## Do this before going live

1. **Set up the first admin from Script Properties.** There is **no default login anywhere in the code or the
   repository.** `setup()` reads `FIRST_ADMIN_LOGIN` and `FIRST_ADMIN_PASSWORD` from Script Properties, creates the
   admin, and deletes the password property ([SETUP.md](google-apps-script/SETUP.md) steps 4 and 5). Choose a long,
   unique password. (The local development backend creates a throw-away `admin.ccs.chandigar` login in a git-ignored
   file on first start; it only listens on your own computer.)
2. **Own the secrets yourself.** Whoever can open the Apps Script project can read the GitHub token in Script
   Properties, and that token can push to the repository. If only you should be able to change the site, create the
   Google Sheet and script in **your own** Google account, or keep the script in your account and point it at the
   institute's sheet with `SHEET_ID` ([SETUP.md](google-apps-script/SETUP.md) step 1). Do not hand the institute the
   Google account that owns the script.
3. **Protect your accounts and the token** (settings on GitHub and Google that no code in this repository can switch
   on; do them once):
   - Turn on two-factor authentication on your GitHub and Google accounts.
   - Keep the GitHub token fine-grained: only `ccs-website`, only **Contents: Read and write**, with an expiry date
     (put the renewal in your calendar). Without the "Workflows" permission it cannot change the deploy workflow.
   - Do not add anyone to the repository who should not be able to change the site, and keep **Settings > Actions >
     General > Workflow permissions** on "Read repository contents".
   - Do **not** protect `main` against direct pushes unless you also set up the strict mode described under
     "Residual risk": the admin panel saves content by committing to `main`, so a fully protected `main` stops it.
4. **Private repository.** Free GitHub accounts can only publish GitHub Pages from a **public** repository. The code is
   then readable by anyone, but only collaborators you add can change it. If the source must be private, use a paid
   GitHub plan, or host the built site on a service that deploys from private repositories (for example Cloudflare
   Pages or Netlify, both have free plans) and keep this repository private.
5. Share the Google Sheet only as **Viewer** (or not at all). The Admins tab is hidden and protected, but it holds
   password hashes and should never be editable by staff.
6. After the domain is attached, tick **Enforce HTTPS** in Pages settings.
7. Never commit `dev-server/data/enquiries.json` (it is git-ignored) or any real enquiry export.
8. Now and then run `npm run prune:uploads`: replaced or deleted pictures stay on GitHub and stay downloadable from
   the live site until you remove them (for example an old photo of a student).

## What was tested

| Area                              | Result                                                                                                                                                                                                                                                                                                                                                                                         | How it is checked                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Dependencies                      | `npm audit`: 0 known vulnerabilities                                                                                                                                                                                                                                                                                                                                                           | run during the review                                             |
| Secrets in the repo               | none found (token, key and credential patterns)                                                                                                                                                                                                                                                                                                                                                | repository-wide scan                                              |
| Unsafe HTML sinks                 | the only `set:html` is the JSON-LD tag, with `<` escaped; `dangerouslySetInnerHTML` is used only for built-in icons                                                                                                                                                                                                                                                                            | code search                                                       |
| Hostile content                   | `javascript:` / `vbscript:` / `data:` / `//host` links typed into Settings, Home, Exam Updates never become links; `</script><img onerror>` in a title is escaped                                                                                                                                                                                                                              | temporary hostile content + production build + grep of the output |
| Query injection                   | `/search/?q=<img onerror=...>` is shown as text and never executed                                                                                                                                                                                                                                                                                                                             | `npm run e2e`                                                     |
| Auth                              | no token, tampered signature, forged expiry with a real signature, expired token (12 h), deactivated admin with a valid token: all rejected                                                                                                                                                                                                                                                    | `npm run e2e`, `npm run test:gs`                                  |
| Brute force                       | login locks after 5 failures per login for 15 minutes; identical error for unknown login and wrong password                                                                                                                                                                                                                                                                                    | `npm run e2e`, `npm run test:gs`                                  |
| Path traversal / arbitrary writes | content paths must match `<allowed-folder>/<slug>.json`; `..`, absolute paths, null bytes, other folders, other extensions all rejected                                                                                                                                                                                                                                                        | `npm run e2e`, `npm run test:gs`                                  |
| Content payloads                  | non-object JSON, invalid JSON, `__proto__` / `constructor` keys, oversized JSON, landing slug that does not match its file name: all rejected                                                                                                                                                                                                                                                  | `npm run e2e`, `npm run test:gs`                                  |
| Uploads                           | only WebP images and PDFs, detected from the file's own bytes (an SVG or HTML renamed to `.webp` is rejected), size caps, folder allow-list, PDFs only in `resources`, file names sanitised                                                                                                                                                                                                    | `npm run e2e`, `npm run test:gs`                                  |
| Lost updates                      | saves send the file `sha`; a stale save is a conflict, not an overwrite. Enquiries are updated by a stable ID, not a row number, so new enquiries arriving meanwhile cannot redirect an edit to the wrong person                                                                                                                                                                               | `npm run test:gs`                                                 |
| Spreadsheet formula injection     | values starting with `=` `+` `-` `@` are stored neutralised; the CSV export neutralises them again                                                                                                                                                                                                                                                                                             | `npm run e2e`, `npm run test:gs`                                  |
| Header / CSV-row injection        | control characters (newlines, NUL) are stripped from every form field                                                                                                                                                                                                                                                                                                                          | `npm run test:gs`                                                 |
| Spam                              | honeypot field (silently dropped), same mobile within 10 minutes is a duplicate, 60 s re-submit block in the browser, global cap of 30 submissions per minute, all fields length-capped and re-validated on the server                                                                                                                                                                         | `npm run e2e`, `npm run test:gs`                                  |
| Script injection                  | the Content-Security-Policy blocks an injected inline script; the whole site and admin run with no policy violations                                                                                                                                                                                                                                                                           | `npm run e2e`                                                     |
| Instagram reels                   | the embed address is rebuilt from a validated shortcode only (a `javascript:` or non-Instagram link is refused by the form and ignored by the site); the player loads only after a tap, in a sandboxed frame without top-level navigation; the CSP allows only `www.instagram.com` as a frame source                                                                                           | `npm run e2e`                                                     |
| Clickjacking                      | the admin refuses to run inside a frame                                                                                                                                                                                                                                                                                                                                                        | `npm run e2e`                                                     |
| Data in URLs                      | a form submitted before the page finished loading cannot fall back to a native GET submit that would put a name and mobile number into the address bar                                                                                                                                                                                                                                         | code + `form-action 'self'`                                       |
| Layout lock (server side)         | fields the admin screen does not have are dropped; over-long text, unknown options, `javascript:` links, pictures from other sites, `..` paths and wrong types are refused; the Free Tests switch cannot be flipped either way; a course's category cannot change; `settings/site.json` and `home/home.json` cannot be deleted or copied; every shipped content file passes the lock unchanged | `npm run test:gs`, `npm run e2e`                                  |
| Generated lock is current         | `google-apps-script/content-rules.json` and the block in `Code.gs` must match `src/admin/schemas.ts`                                                                                                                                                                                                                                                                                           | `npm run test:gs`, deploy workflow                                |
| No default login                  | `Code.gs` contains no password or hash; `setup()` refuses to run without `FIRST_ADMIN_*` properties and deletes the password property afterwards                                                                                                                                                                                                                                               | `npm run test:gs`                                                 |
| Pictures                          | the upload is re-encoded as WebP (this strips EXIF data such as GPS), capped in width and size; the build makes AVIF/WebP copies and never changes the original                                                                                                                                                                                                                                | `npm run test:images`, `npm run e2e`                              |
| Right-click                       | the context menu and image dragging are blocked on the public site, but not in text fields or the admin                                                                                                                                                                                                                                                                                        | `npm run e2e`                                                     |
| Default credentials               | first login with a default or temporary password can only set a new one; temporary passwords given to new admins and after resets behave the same                                                                                                                                                                                                                                              | `npm run e2e`, `npm run test:gs`                                  |

## Findings

| #   | Severity | Finding                                                                                                                                                                                            | Status                                                                                                                                                        |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | The default admin password hash was in a (possibly public) repo, so the default login could be tried against the public backend URL                                                                | **Fixed:** there is no default login. The first admin is created from Script Properties by `setup()`                                                          |
| 2   | Medium   | Footer map and social links came straight from editable settings, so a `javascript:` URL typed by an admin would have been a live link                                                             | **Fixed:** all links from editable content go through `safeHref`                                                                                              |
| 3   | Medium   | A form submitted before hydration would reload the page with the visitor's name and mobile in the URL                                                                                              | **Fixed:** submit guard on un-hydrated forms; mobile field limit raised so pasted `+91 98765 43210` is not truncated                                          |
| 4   | Medium   | The admin could be framed by another site (clickjacking); GitHub Pages cannot send `frame-ancestors`                                                                                               | **Fixed** with a frame guard in the admin app. Residual: the public pages can still be framed (they hold no secrets)                                          |
| 5   | Low      | Control characters in form fields could inject email headers or break CSV rows                                                                                                                     | **Fixed:** stripped server-side                                                                                                                               |
| 6   | Low      | Image or video links typed into the admin could point at other sites                                                                                                                               | **Mitigated:** the CSP limits images to this site and YouTube thumbnails, frames to YouTube, and media to https; links are limited to http(s), mailto and tel |
| 7   | Low      | Row-number based updates could edit the wrong enquiry when a new one arrives                                                                                                                       | **Fixed:** stable ID column                                                                                                                                   |
| 8   | Info     | The admin video preview was blocked because the page sent no referrer (YouTube requires one)                                                                                                       | **Fixed**                                                                                                                                                     |
| 9   | High     | The content API accepted any JSON shape from a signed-in admin, so a hand-made request could add fields, flip developer-only switches (Free Tests), delete `home.json` and break every later build | **Fixed:** the server-side lock described in "Who can change what"                                                                                            |
| 10  | Medium   | Whoever can open the Apps Script project can read the GitHub token and so change the site's code                                                                                                   | **Documented:** keep the script in the developer's Google account; fine-grained token with an expiry; see "Do this before going live" and "Residual risk"     |
| 11  | Low      | Replaced pictures (for example an old student photo) stay on GitHub and on the live site                                                                                                           | **Mitigated:** `npm run prune:uploads` lists and deletes unused uploads                                                                                       |
| 12  | Low      | A student photo uploaded from a phone carries GPS location in its EXIF data                                                                                                                        | **Fixed:** every upload is re-encoded in the browser, which drops EXIF data                                                                                   |

## Accepted risks and trade-offs

These are deliberate, in proportion to a static site with a contact form.

- **Password hashing is salted SHA-256** (as specified). It is not a slow hash like bcrypt, which Apps Script does not
  provide. This only matters if the Admins sheet leaks, which is why it is hidden, protected, owner-only and why the
  sheet should be shared as Viewer at most. Passwords must be at least 8 characters with a letter and a number.
  Use long, unique passwords.
- **Sessions are stateless** (a signed token valid 12 hours, kept in `sessionStorage`). Logging out removes it from
  the browser but cannot revoke it on the server. To end every session at once, change the `SIGNING_SECRET` script
  property. Deactivating an admin cuts their access immediately.
- **The login lockout can be abused to lock a real admin out** for 15 minutes by failing five times. The alternative
  (no lockout) is worse; the attacker cannot get in either way.
- **Enquiry spam is limited, not eliminated.** There is no CAPTCHA (it would add a third-party script and friction
  for students on 4G). A determined bot using many different mobile numbers could still add rows. If it happens,
  add Cloudflare Turnstile or reCAPTCHA to `EnquiryForm.tsx` and verify the token in `submitEnquiry_`. The 30 per
  minute cap also means a flood can briefly block genuine leads; the phone and WhatsApp fallback is shown then.
- **GitHub Pages sends no custom HTTP headers.** HTTPS and HSTS come from GitHub. The Content-Security-Policy is a
  `<meta>` tag (it cannot express `frame-ancestors`), and `X-Content-Type-Options` cannot be set. CSP in a meta tag
  is not applied in `npm run dev`; test it with a build.
- **A bad content save cannot break the build any more**, because the backend checks every field against the admin
  schema (see "Who can change what"). The deploy workflow still runs `npm run check` and `npm run build` first, so
  anything unexpected leaves the previous site live.
- **All admins have the same powers**, as specified: they can read every enquiry, change every piece of content and
  add or deactivate other admins. None of them can change layout or features.
- **The repository is public if you use free GitHub Pages.** It contains content and code, but no secrets, no passwords and no
  enquiries. The Apps Script URL is public by design.
- **Disabling right-click is a deterrent, not protection.** It stops casual "save image" and copying from the page.
  Anyone determined can still use the browser menu, developer tools, view-source or a screenshot, and anything the
  browser can show can be copied. Text fields keep their menu so a phone number can be pasted into the form.
- **Residual risk: the GitHub token.** The backend only ever writes `src/content/` and `public/uploads/`, and every
  value is checked (see "Who can change what"). But the token itself could push anywhere in the repository, so
  anyone who obtains it (from the Apps Script project, or from a leak) could change code. The measures above (script
  in your own Google account, fine-grained token with an expiry, two-factor authentication) make that unlikely.
  **Strict mode is not included.** It would close the gap completely: the admin panel commits to a separate `content`
  branch (`GITHUB_BRANCH` in `Code.gs`), `main` is protected so only you can change it, and the deploy workflow builds
  code from `main` and takes only `src/content/` and `public/uploads/` from the `content` branch. It changes the
  deploy flow, so build it only if you want it.
- **Third-party services:** YouTube (embeds load only on click or on desktop, via the privacy-enhanced domain), Instagram
  (reel player loads only after a tap, sandboxed; it sets Instagram's own cookies once opened), Google
  Drive links, Google Apps Script and GitHub. Each has its own policies.

## Not covered

- `Code.gs` has been exercised against faithful fakes (`npm run test:gs`) but not on a real Google account. Run the
  test steps in [SETUP.md](google-apps-script/SETUP.md) once after deploying, including a deliberate wrong login and a
  save with a stale page open.
- No external penetration test, and no testing in Safari or Firefox beyond what the browser engine guarantees. The
  admin's image conversion needs Chrome, Edge or Firefox.
- Operational security: protect the institute's Google account and the developer's GitHub account with two-factor
  authentication. A takeover of either bypasses everything above.

## Re-running the checks

```bash
npm audit
npm run test:gs                         # Code.gs against fakes, incl. the layout lock
npm run test:images                     # responsive picture pipeline
npm run rules -- --check                # the generated lock matches src/admin/schemas.ts
npm run dev:api &                       # then in another terminal:
npm run build:local && npm run e2e
npm run check:layout
```
