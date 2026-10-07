# Admin guide (for CCS staff)

Open the admin at **your-website-address/admin/** and sign in with the login and password you were given.
You do not need a GitHub or Google account. Content you save goes live on the website in **about 2 minutes**
(you will see a green message saying so).

> **First sign-in:** if you were given a temporary password, you will be asked to choose your own before you
> can do anything else. Pick something only you know: at least 8 characters, with a letter and a number.

Sample entries are marked **Sample**. Edit or delete them before launch.

**What you can and cannot change.** You change the **content**: text, prices, pictures, links, videos, results, exam updates and
enquiries. The **layout** (how pages look, the menus, which sections exist) and the website's **features** are fixed and
only your developer can change them. Anything the screens do not offer is refused by the system, so nothing you do here can
break the design.

## The tabs

Enquiries · Home Page · Courses · Results · Teachers · Free Resources · Exam Updates · Landing Pages · Settings

---

## Enquiries (the main screen)

Every form on the website lands here, newest first. Two small tables at the top count the enquiries by status and
by exam and year of attempt. They change as you filter.

Only the **name, mobile number and exam** are always filled in. The year of attempt, email, city and message are
optional on the form, so some rows have them blank (shown as a dash).

**Update a status**

1. Find the student (use **Search** for a name, mobile, email or city, or the filters).
2. Open the **Status** dropdown on their row and pick **Open, Contacted, Resolved** or **Enrolled**.
3. A small green **Saved** appears. Nothing changes a status except you.

_Resolved_ means the student was answered but did not enrol. _Enrolled_ means they joined.

**Add a note**: click the note on the row (or **Add note**), type, then click anywhere else. It saves by itself.
Press **Esc** to cancel.

**Call or WhatsApp**: click **Call** or **WhatsApp** under the mobile number.

**Filter**: Date (Today, Last 7 days, Last 30 days, This year, Custom), Exam, Year of attempt (choose **Not given** to see
students who left it blank), Status, Source.
**Source** tells you where the student came from: _Popup_, _Page: /courses/_, _Exam updates sign-up_ or
_Landing: the-page-name_ (a campaign page).

**Export**: **Export CSV** downloads exactly the rows you are looking at (open it in Excel or Google Sheets).
The table refreshes by itself every minute.

---

## Add a result (topper) with a photo

1. **Results > Add result.**
2. **Upload image** and choose the student's photo. It is shrunk and converted for you (see "Pictures" below).
3. Fill in the **name, exam, year** and **rank label** (for example _AIR 07_ or _Rank 03_).
4. Tick **Show on the Home page** if this result should appear on the Home page.
5. **Save.** Use the **↑ ↓** buttons to change the order and the **Published** tick to hide a result.

## Add an Instagram reel (topper testimonial)

The **Reels** tab controls the swipeable reel carousel in the middle of the Home page and on the Results page.

1. On Instagram open the reel, tap the **three dots**, then **Copy link**. (The Instagram account must be public.)
2. **Reels > Add reel.** Paste the link, type the **student name**, and the **rank and exam** in this form:
   `AIR 07 · UPSC CSE 2025` (rank first, then a dot).
3. **Upload image** for the **cover picture**: a tall picture, for example a screenshot of the reel. Without one the
   card shows a coloured background.
4. **Save.** Use the **↑ ↓** buttons to change the order, or untick **Published** to hide a reel.

Visitors tap a card to watch the reel; it plays from Instagram and nothing is loaded from Instagram until they do.

## Pictures

Choose any JPG, PNG or WebP photo (up to 25 MB), straight from your phone or camera. The system does the rest:

- It **shrinks** the picture to the size the website needs and saves it in a modern, small format (WebP). This also
  removes hidden data such as the place where a photo was taken.
- You see a message such as _Picture optimised: 2.4 MB → 86 KB_ and the preview appears at once.
- The website then makes even smaller copies for phones, so pages open fast on mobile data.

You do not need to resize or compress anything yourself. Use a clear, well-lit picture in the shape suggested under the
field (for example a portrait for people). If you replace a picture, the old file stays on the server until your
developer clears unused files, so do not upload anything that must never be public.

## Add a teacher

1. **Teachers > Add teacher.**
2. Upload the photo and fill in the name, subject, credential and a short bio.
3. Optional: paste a YouTube link in **Intro video link**: a "Watch intro" button appears.
4. **Save.**

## Upload a free resource

1. **Free Resources > Add resource.**
2. Pick the **Category** and the **Type**.
3. **PDF:** choose **Upload a PDF** (under 5 MB). **Anything else** (Google Drive, YouTube, a website): paste the
   link in **Link**. Use one of the two, not both.
4. Tick **Show in the Home page carousel** if you want it on the Home page.
5. **Save.**

## Post an exam update

1. **Exam Updates > Add update.**
2. Set the **date**, **exam body** (UPSC, PPSC...), **category** (Notification, Admit card, Result...) and **title**.
3. Paste the **official link**.
4. **Save.** The newest three also appear on the Home page.

## Change the Home page video (and other Home content)

1. **Home Page.** The layout is fixed; only text, pictures and the video can be changed.
2. The top of the Home page (the **hero**) plays your video behind the headline. Under **Hero**, paste a
   **YouTube link** in **Video link**. A preview appears so you can check it.
3. Set the **Welcome line** (small text above the headline), the **Headline**, sub-text and the two buttons.
4. The **search bar** sits at the bottom of the hero. Change its **hint text** and the **Popular searches**
   (up to 6 quick-tap words shown when someone clicks the bar). Visitors can search free resources, exam updates
   and results there. You do not need to do anything to keep it up to date: it finds whatever you publish.
5. The **four stat tiles** appear just under the search bar.
6. The counters (like 42/70) show how much space you have. Click **Save changes** (at the top or the bottom).

On phones the video is shown as the poster image with a Play button to save the visitor's data.

## Courses

You can change a course's **thumbnail, name and price**, add a course, delete one, reorder, or untick **Published**
to hide it. The **category** is chosen when you add the course and cannot be changed afterwards.
To choose the three courses shown on the Home page, use **Home Page > Featured courses**.

## Landing pages (campaign pages for ads)

Every landing page uses the same fixed layout.

1. **Landing Pages > Add landing page.**
2. Choose a **Page address** (for example `ias-foundation-2027`). It cannot be changed later.
3. Fill in the headline, bullet points, optional countdown, benefits and FAQs, then **Save**.
4. Tick **Published** to put it live. **Copy link** gives you the address to use in your ads. Enquiries from that
   page are tagged with its name so you can count them.
5. **Duplicate** copies a page to start a new campaign. Unticking **Published** removes the page from the website.

## Settings

- Phone, WhatsApp, email, address and social links shown across the site.
- **Year-of-attempt choices** in the enquiry form (add or remove years).
- Free Tests is a feature your developer switches on when the tests are ready; it is not a setting here.
- **Admins:** add a person (give them a temporary password; they must change it at first sign-in), reset a password
  or deactivate someone who has left.
- **Change my password.**

---

## Good to know

- After you save, wait about 2 minutes, then refresh the website to see the change.
- If two people edit the same item at the same time you will see a message and the latest version is loaded.
  Apply your change again.
- **Sign out** when you finish, especially on a shared computer. You are signed out automatically after 12 hours.
- Never share your password. If you think someone knows it, change it in Settings.
- Student details are private. Do not forward the CSV file outside the institute.
- Right-click is switched off on the public website (it stops casual copying of pictures). It works normally here in the admin
  and inside the website's text boxes.

## If something goes wrong

| What you see                                  | What to do                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| "Session expired"                             | Sign in again.                                                                       |
| "Too many failed attempts"                    | Wait 15 minutes, then try again.                                                     |
| An image will not upload                      | Use a JPG, PNG or WebP picture. Use Chrome, Edge or Firefox.                         |
| "... is too long" or "... is required"        | Shorten the text or fill the field. The counters beside each box show the limit.     |
| "This page cannot be deleted"                 | The Home page and Settings are fixed pages: edit them, they cannot be removed.       |
| A PDF is too large                            | Keep it under 5 MB, or put it on Google Drive and paste the link.                    |
| The change is not on the site after 5 minutes | Tell your developer. The site may have rejected the change and kept the old version. |
