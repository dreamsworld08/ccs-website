# Backend setup (Google Apps Script)

This is done **once**, when the site goes live. Until then, `npm run dev` uses a local stand-in
(`dev-server/server.mjs`) that behaves the same way, so nothing here is needed to build or demo the site.

The backend lives in the institute's own Google account. It does five things:

1. receives enquiries from the website forms and writes them to a Google Sheet,
2. checks admin logins (login + password, no GitHub account needed),
3. shows the enquiries to the admin panel,
4. saves content edits and uploaded images to the GitHub repo, which rebuilds the site,
5. optionally serves the live Instagram feed for the Home page (step 8).

You need: the **institute's Google account**, the **GitHub repo** (`ccs-website`) and about 20 minutes.

---

## Step 1: Create the sheet (and decide who owns the script)

Whoever can open the Apps Script project can read its Script Properties, which include the **GitHub token** (step 4),
and that token can push to the repository. So the account that owns the script decides who can change the site's code.

| Setup                                                          | Who can read the token               | Use it when                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **A. Sheet and script in the developer's own Google account**  | only the developer                   | **Recommended** if only the developer must be able to change the site. Staff never need the sheet: they use `/admin/` |
| B. Sheet and script in the institute's Google account          | whoever controls that Google account | simplest; fine if the institute is trusted with the code                                                              |
| C. Sheet in the institute's account, script in the developer's | only the developer                   | the institute must own the enquiry data (see below)                                                                   |

**A or B:** sign in to the right Google account, open <https://sheets.new> and rename the spreadsheet to **CCS Enquiries**.

**C:** the institute creates the sheet **CCS Enquiries** and shares it with the developer's Google account as **Editor**.
The developer creates a standalone script at <https://script.google.com> (New project) instead of using Extensions in the
sheet, and in step 2 also changes `appsscript.json`: replace the scope
`https://www.googleapis.com/auth/spreadsheets.currentonly` with `https://www.googleapis.com/auth/spreadsheets` and delete
the `script.container.ui` line. In step 4 add a property `SHEET_ID` with the long id from the sheet's address
(`docs.google.com/spreadsheets/d/<this part>/edit`).

## Step 2: Paste the script

1. In the sheet: **Extensions > Apps Script** (setup C: use your standalone project instead).
2. Delete the placeholder code. Open `google-apps-script/Code.gs` from the repo, copy everything and paste it in.
3. (Recommended) In the left sidebar open **Project Settings (gear icon)** and tick
   **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace its content with the
   file of the same name from the repo. Save.
4. Optional: at the top of `Code.gs`, set `ALERT_EMAIL` to get an email for every new enquiry.
5. Click the save icon.

## Step 3: Create the GitHub token (developer, 3 minutes)

The token lets the script commit content edits to the repo. It never goes in the website code.

1. GitHub > your profile picture > **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. Name: `ccs-admin`. Expiration: 1 year (put a reminder in your calendar to renew it).
3. **Repository access: Only select repositories > ccs-website.**
4. **Permissions > Repository permissions > Contents: Read and write.** Leave everything else on "No access".
5. Generate and copy the token (it starts with `github_pat_`). You cannot see it again.

## Step 4: Set the Script Properties (secrets)

In Apps Script: **Project Settings > Script Properties > Add script property**. Add these:

| Property               | Value                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`         | the token from step 3                                                                           |
| `GITHUB_REPO`          | `your-github-username/ccs-website`                                                              |
| `SIGNING_SECRET`       | a long random string, at least 32 characters (mash the keyboard, or run `openssl rand -hex 32`) |
| `FIRST_ADMIN_LOGIN`    | the login of the first admin, for example your own email (3+ characters)                        |
| `FIRST_ADMIN_PASSWORD` | a long, unique password: 8+ characters with a letter and a number                               |
| `FIRST_ADMIN_NAME`     | optional: the name shown next to changes, default `Administrator`                               |
| `SHEET_ID`             | only for setup C (step 1)                                                                       |

> Never put these in the repo, in an email or in the website code. If the token leaks, delete it on GitHub and make a new one.

## Step 5: Run setup() once

1. In the editor, pick **setup** in the function dropdown (top bar) and press **Run**.
2. Google asks for permission: **Review permissions > choose the account > Advanced > Go to CCS Enquiries (unsafe) > Allow.**
   (It says "unsafe" only because you wrote the script yourself and Google has not reviewed it.)
3. When it finishes, the sheet has these tabs: **Enquiries**, **Summary** and a hidden **Admins** tab. It also created
   the first admin from `FIRST_ADMIN_LOGIN` / `FIRST_ADMIN_PASSWORD` and then **deleted the password property**, so the
   password is nowhere except as a salted hash in the hidden Admins tab. **There is no default login:** if you forgot
   the two properties, `setup()` stops with a message saying so, and nothing is created.
4. Add the real staff under **Settings > Admins** in the admin panel (they get a temporary password and must replace it
   at their first sign-in). Staff can change content only; layout and features can only be changed in the code.

## Step 6: Deploy as a web app

1. **Deploy > New deployment > gear icon > Web app.**
2. Description: `CCS backend v1`. **Execute as: Me.** **Who has access: Anyone.**
3. **Deploy**, then copy the **Web app URL** (it ends in `/exec`).

> "Anyone" only means anyone can _call_ the URL. Admin actions all require a login token. The URL is public by design.

## Step 7: Connect the website

1. Open `src/config/backend.ts` and replace `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` with the URL from step 6.
2. Commit and push. GitHub rebuilds the site (about 2 minutes).
3. Test: open the live site, submit the enquiry popup, and check a new row appears at the top of the **Enquiries** tab with Status **Open**. A form with only name, mobile number and exam must work too: the other fields are optional.
4. Sign in at `/admin/` with the first admin and check that Settings has no Free Tests switch (that one belongs to the developer).

## Step 8 (optional): Instagram live feed

Nothing to do in Apps Script for this: it is already in `Code.gs`, and the `IG_*` Script Properties are written by the
admin panel itself (never add them by hand; the access token must not be typed anywhere but **Admin > Instagram**).

1. The institute's Instagram account must be a **Business or Creator** account.
2. On developers.facebook.com create an app, add the **Instagram** product, choose "API setup with Instagram login",
   add the account and **Generate token**. (Meta rearranges these screens now and then; what you need is a long-lived
   access token for "Instagram API with Instagram Login".)
3. Sign in to `/admin/`, open **Instagram**, paste the token, press **Connect**. The tab shows `@account` and a
   preview of the posts, and the Home page shows them (within seconds the first time).
4. **Check it on the real thing**, because the automated tests use a pretend Instagram: after connecting, open the Home
   page and confirm the posts appear and open in the player; publish a new post and confirm it appears within about
   15 minutes; press **Refresh now** and confirm the tab says "Posts reloaded"; later, check the days left in the tab
   goes back up to about 60 after the first automatic renewal (10 days after connecting).

Notes: Apps Script needs the permission to call external services (`script.external_request`, already in
`appsscript.json`); if you re-deploy and Google asks to authorise again, accept. The token is kept only in Script
Properties; if it leaks, press **Disconnect** (deletes it) and revoke the app's access in Instagram (Settings >
Apps and websites).

## Updating the script later

Changing `Code.gs` needs a **new version** of the deployment: **Deploy > Manage deployments > pencil icon > Version: New version > Deploy.**
The URL stays the same.

## Sharing the sheet with staff

- Staff normally never need the sheet: they use the admin panel.
- If someone needs to see it, share as **Viewer**, never Editor. The Admins tab holds password hashes and is hidden and protected, but only the owner account is a safe place to manage it.
- Do not rename or reorder columns and do not delete the **ID** column. The admin panel finds rows by it.

## Troubleshooting

| Symptom                                                        | Fix                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin says "Session expired" straight after login              | `SIGNING_SECRET` is missing or shorter than 16 characters.                                                                                                                                                 |
| "GITHUB_REPO / GITHUB_TOKEN script properties are missing"     | Step 4, check the spelling of the property names.                                                                                                                                                          |
| "Could not save to GitHub (error 401/403)"                     | Token expired or lacks **Contents: Read and write** on `ccs-website`.                                                                                                                                      |
| "Could not save to GitHub (error 404)"                         | `GITHUB_REPO` is wrong, or the token was not granted this repo.                                                                                                                                            |
| Enquiry form shows "Call us / WhatsApp us"                     | The URL in `src/config/backend.ts` is wrong or the deployment access is not "Anyone".                                                                                                                      |
| Times look wrong                                               | Project Settings > Time zone must be **Asia/Kolkata** (setup() also sets the sheet's time zone).                                                                                                           |
| Instagram tab: "Instagram no longer accepts this access token" | The token expired (no website visits for ~50 days) or was revoked. Generate a new one and use **Replace access token**.                                                                                    |
| Instagram section missing on the Home page                     | Tab says not connected, or the switch is off, or there are no posts yet (press **Refresh now**). Check the Apps Script URL in `src/config/backend.ts` is set: without it the section is not built at all.  |
| Lost the admin password                                        | In the hidden Admins tab (View > Hidden sheets) paste a new salt + hash made with `npm run hash -- 'NewPassword1'`, or delete the admin's row, add the `FIRST_ADMIN_*` properties again and run `setup()`. |
