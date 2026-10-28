# Data settings

_Copied from the Notion spec on 2026-10-28. If they differ, Notion wins._

> 🗄️ Phase 3 · Feature list: Data settings · Depends on: Page history and Trash, Analytics, Status page (backups), Import and export · Upload limits agree with the build contract (docs/decisions/0007, section 4.3)

## 1. What it's for

Admins decide how long Care Hub keeps old page versions, deleted items and activity, see what uses the disk, and set upload limits. Site admins also check backups, export everything and delete a workspace.

## 2. Screens and states

- **Settings → Data** (Admins), in parts: Keeping data · Storage · Uploads · Backups (site admins) · Export everything (site admins) · Delete workspace (site admins).
- **My account → Export my content** (everyone; section 3.6).
- **States:** loading skeleton; "Saved" after a change; a confirm before any change that deletes data (section 3.1); storage shows "Updated 12 minutes ago" with Refresh; an export in progress shows its progress bar and can be cancelled.

## 3. Behavior and edge cases

### 3.1 Keeping data

| Data | Choices | Default |
| --- | --- | --- |
| Automatic page versions (Page history and Trash) | 30 days, 90 days, 1 year, forever | 1 year (🟨 DS-D2) |
| Named page versions | Kept until someone deletes them | — |
| Trash: pages, databases, rows and their files | 7, 30 or 90 days | 30 days (🟨 DS-D2) |
| Activity for Analytics | 90 days, 1 year, 2 years | 1 year (AN-D2) |
| Security log and access history | The same as Analytics activity | — |
| Deleted database properties | 30 days (fixed) | — |
| Messages | Kept until deleted by their sender | — |
| Automation runs | Last 100 per automation (fixed) | — |
| Backups | 30 nightly backups (fixed, Feature list) | — |

- The clean-up runs every night after the backup finishes. It deletes what's older than each period, then removes files that nothing uses anymore.
- Shortening a period first shows what will go: "Tonight this permanently deletes 1,240 page versions older than 90 days. Backups keep them for up to 30 more days." Delete tonight or Cancel. Lengthening a period can't bring back what's already gone.
- Each clean-up is recorded with counts, shown under Keeping data ("Last clean-up: Oct 28, 3:04 AM · 312 versions, 18 pages, 2.1 GB of files").

### 3.2 Storage

- Total used and free disk space (the same numbers as the Status page), split into page content, page versions, files (pictures, video, PDFs, other), message files, backups and the search index. Updated every hour.
- Use by space (private spaces show as "Private pages", one total for everyone).
- **Largest 50 files:** name, size, kind, uploaded by, when, and where: the page title if the Admin can open it, otherwise "A page you can't open"; message files show "In a chat". Clicking opens the place when the Admin may.
- Under 15% free: a banner for Admins here and on the Status page. Under 10%: the Status page notice. Under 2 GB free: uploads pause everywhere with "Uploads are paused because the server is almost full. An Admin has been told."

### 3.3 Uploads

These rules apply to every way a file arrives: blocks, covers and icons, database Files properties, forms, comments, messages and imports. Smaller limits in other specs (for example, 5 MB icons) still apply.

- **Largest file:** 100 MB by default. Site admins can set it between 1 MB and 1,000 MB; Admins can set a lower one for their workspace. 1 MB = 1,048,576 bytes; sizes in messages follow File sizes in the Specs index (one decimal; a file over the limit never shows the limit itself as its size).
- **Programs are refused**, judged by the file's real contents and by its name ending: Windows, Mac, Linux and phone programs and installers, and scripts that run when opened (for example .exe, .msi, .bat, .cmd, .com, .scr, .ps1, .vbs, .jar, .app, .dmg, .pkg, .apk, .deb, .rpm, .sh). The message says "Programs can't be uploaded." Admins can add more endings; the built-in ones can't be removed.
- **Pictures:** location and camera details are removed before saving: all EXIF, XMP and IPTC data except the orientation and the color profile. HEIC and AVIF keep their format; the web uploader turns HEIC into JPEG first when the browser can. Where a browser can't show a HEIC picture, it appears as a file with Download. SVG is accepted only to be shown as a picture and is never put into a page as code.
- **Showing files:** pictures, video, audio and PDFs open in the browser; everything else downloads. HTML and other web files always download and never open as pages.
- Every file is checked on the server; what the browser says about a file is never trusted.

### 3.4 Backups (site admins)

- The Status page runs and checks the nightly backups. Here site admins see: the backup time (default 2:00 AM, America/Denver; changeable), where backups are kept on the server, the 30 kept backups (date, size, result, last restore test) and Back up now.
- **Download a backup:** for keeping a copy somewhere else. It needs the password again, and the download is logged in the Security log.
- Restoring a whole backup is done on the server by a site admin, following the runbook; it's never a button in the browser.

### 3.5 Export everything (site admins)

- One archive of a workspace for keeping an offline copy or moving Care Hub: pages as Markdown and HTML, databases as CSV plus a JSON file with their full structure (properties, views, relations, formulas, templates), files, comments, forms, automations, calendar events made in Care Hub, spaces, members, groups and roles. No passwords, 2-step secrets, keys or sessions.
- Other people's private pages, chats and private events are left out (🟨 DS-D1); each person can export their own (section 3.6).
- It runs in the background with progress. When it's done, the site admin gets a 🔔 notice with a download link that works only for them, for 7 days. The download needs the password again and is logged.

### 3.6 Export my content (everyone)

- Gives a person their own private pages (Markdown and HTML, with files), the chats they're in as they see them (HTML and JSON), the calendar events they made in Care Hub, and their comments.
- Same background run, 🔔 notice and 7-day personal link as above.

### 3.7 Delete workspace (site admins)

- Typing the workspace's name and the password confirms. The workspace closes at once for everyone, and their sessions there end.
- It's deleted forever after 7 days; until then it shows in site admins' workspace switcher as "Closing on Nov 4 · Cancel". Backups that hold it age out over the next 30 days.

## 4. Data it stores

- **Data settings** (per workspace): the periods in section 3.1, the workspace's file limit, extra blocked endings.
- **Site settings:** largest file allowed, backup time.
- **Storage snapshot** (hourly): totals by kind and by space.
- **Clean-up run:** started, finished, counts by kind, space freed, errors.
- **Export job:** who, kind (everything or my content), status, progress, size, file, link expiry, downloaded at.
- **Workspace deletion:** workspace, asked by, delete on, cancelled by.

## 5. Permissions

| Action | Needs |
| --- | --- |
| Keeping data, storage, workspace upload limit and blocked endings | Admin settings permission |
| Backups, export everything, delete workspace, site upload limit | Site admin |
| Export my content | Everyone (guests: the pages shared with them aren't theirs, so only their comments) |

- Direct requests without the permission are refused (403). Export links work only for the person who asked.

## 6. Keyboard and phone

- An ordinary settings form; each choice is a labelled control, and confirms move focus to their main button.
- Phone: one column; tables become lists.

## Done means

Try these in the browser with fictional data. ⭐ marks what the team will notice first. Each check uses its acceptance-check ID from section 7, so tests and results use the same IDs.

1. ⭐ **DS-05** Upload a 100.1 MB file; then, as a site admin, raise the limit to 200 MB and try again. → First it's refused with "This file is 100.1 MB; the limit is 100 MB."; then it's accepted.
2. ⭐ **DS-04** Open Settings → Data → Storage. → The totals match the disk, and the largest-files list shows no title you can't open.
3. ⭐ **DS-01** Under Keeping data, change automatic page versions to 90 days. → It shows how many versions will go; that night exactly those go, and named versions stay.
4. ⭐ **DS-09** As a site admin, choose Export everything. → It finishes in the background; its link works for you only, for 7 days; the archive has pages, CSV, JSON and files, and no secrets or anyone else's private pages, chats or private events.
5. **DS-06** Rename setup.exe to setup.pdf and upload it. → It's refused because of what's inside.
6. **DS-07** Upload a photo with location data and an SVG with a script in it. → The photo is stored without the location; the SVG shows as a picture, and the script never runs.
7. **DS-10** As Sam, choose Export my content. → Sam gets his private pages and his chats as he sees them.
8. **DS-11** Delete a test workspace, then cancel within 7 days. → It closes at once, and cancelling brings it back.
9. **DS-12** Sign in as Sam (not an Admin). → Data settings isn't there.

## 7. Acceptance checks

- **DS-01** Shortening automatic page versions to 90 days shows the count; that night exactly those versions are deleted, and named versions stay.
- **DS-02** Items in Trash longer than the Trash period are deleted at night, and their files leave the disk when nothing else uses them.
- **DS-03** Activity older than the Analytics period is deleted at night (AN-07).
- **DS-04** Storage totals match what's on disk within 1%; the largest-files list never shows a title the Admin can't open.
- **DS-05** With the default limit, a 100.1 MB file is refused with "This file is 100.1 MB; the limit is 100 MB."; after a site admin raises the limit to 200 MB, it's accepted.
- **DS-06** setup.exe renamed to setup.pdf is refused because of its contents; a newly blocked ending is refused too.
- **DS-07** A JPEG with location data is stored without it; an SVG containing a script shows as a picture and the script never runs; an HTML file downloads instead of opening.
- **DS-08** With less than 2 GB free, uploads pause with the message and Admins are told.
- **DS-09** Export everything finishes in the background; its link works only for that site admin, for 7 days; the archive has pages, CSV, JSON and files, no secrets, and no one else's private pages, chats or private events.
- **DS-10** Export my content gives a person their private pages and their chats as they see them.
- **DS-11** Deleting a workspace closes it at once, can be cancelled for 7 days, and then it's gone.
- **DS-12** Non-Admins can't open Data settings, and Admins are refused (403) on the site-admin parts.

## Decisions

- 🟨 **DS-D1** Should Export everything include other people's private pages, chats and private events? **Default:** no, to match RP-D1; each person exports their own.
- 🟨 **DS-D2** Default periods: automatic page versions 1 year, Trash 30 days (Notion keeps Trash 30 days; its version history runs from 7 days to unlimited depending on the plan). **Default:** as listed.
