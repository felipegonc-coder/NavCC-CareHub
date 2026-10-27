# Import and export

_Copied from the Notion spec (https://app.notion.com/p/cfc830eabedc46fc8dea8e74609317f4) on 2026-10-27. If they differ, Notion wins._

> 📦 Phase 1 · Notion parity · Depends on: Pages and blocks, file storage, Roles and permissions (Create), Settings and members (export switches) · Phase 2 parts: database imports and exports (Databases, CSV sections 3.7 and 3.8) · Related: Data settings (upload rules, Export everything, Export my content), Page history and Trash (undo import)

## 1. What it's for

Bringing work into Care Hub from files other tools make, and getting it out again: import Markdown, text, HTML, Word, CSV and Excel files and the exports of Notion, Evernote, Confluence, Trello and Asana; export pages and databases as Markdown and CSV, HTML or PDF; and print. Everything works with files, so Care Hub never connects to another service's account (🟨 IE-D1).

## 2. Screens and states

- **Import** (Import in the sidebar, Import on a new empty page, page menu → Import, or "+" → Import): a grid of sources, each with a short "How to get this file" note: Text and Markdown · HTML · Word · Google Docs (download as Word) · CSV and Excel · Notion export · Evernote · Confluence · Trello · Asana. Then a file picker (or drop), the destination ("Add to:", where it was opened from, or Private) and the source's options. Import starts it.
- **Progress panel** (bottom right, can be closed and reopened from the 🔔 notice): "Importing [notion-export.zip](http://notion-export.zip) · 312 of 1,204 pages" with Cancel. The person can keep working.
- **Summary:** "Imported 1,204 pages, 6 databases, 4,310 rows and 890 files into Support." A list of problems (file, what happened, why) that can be downloaded as CSV, Open, and Undo import.
- **Dropping a file into a page:** dropping a .md, .txt, .html or .docx file asks "Add as a file, or import its content here?"
- **Export** (page menu → Export, or "…" on a database): format (Markdown and CSV, HTML, PDF), and options: Include sub-pages (off), Include files and pictures (on), Databases (This view or Everything), and for PDF the paper size (Letter, A4 or fit to content) and scale (50–200%). Export starts it.
- **Print** (page menu → Print; Ctrl+P is search): a clean print view with the browser's print dialog, plus "Open all toggles".

| State | What shows |
| --- | --- |
| File not accepted | "Pick a .enex file from Evernote." or "This zip isn't a Notion export." |
| Too big | "Imports can be up to 2 GB." |
| Import running | The progress panel; the destination shows "Importing…" with a spinner |
| Import finished with problems | The summary with "3 problems" open |
| Import failed | "The import stopped: the zip is damaged. Nothing was added." with Try again |
| Export running | "Preparing your export (42%)". A 🔔 notice with the download link when it's ready |
| Export not allowed | Export is hidden; direct requests are refused (403) |

## 3. Behavior and edge cases

### 3.1 Import: general rules

- Imports run on the server in the background, one at a time per person (more wait in line). Cancel stops it and removes what it added.
- **Limits:** one file up to 2 GB; once unpacked, up to 5 GB, 10,000 pages and 50,000 files. Zips inside zips aren't opened.
- **Safety:** every file inside follows the upload rules (Data settings, and the build contract 0007 section 4.3): 100 MB per file, programs refused, SVG only as a picture, and location data removed from photos. HTML is cleaned: scripts, forms, frames and styles that run code are removed. Paths that point outside the zip are ignored. Links keep only http, https, mailto and tel (Pages and blocks).
- **Links between imported pages** are changed to point at the new pages (page mentions or block links when they pointed at a heading). Links to files in the import point at the uploaded files. Other links stay as they are.
- **Pictures from the web** inside imported pages follow PB-D3: downloaded when public and up to 10 MB, otherwise kept as links.
- **Mentions of people** are matched to members by email, then by exact name; unmatched ones become plain text ("@Sam Ortiz"). Imported mentions never send notices (Comments and mentions).
- **Dates:** created and edited dates from the files are kept in Updates ("Imported from Evernote. First created Mar 3, 2021"); the page's own created date is the import time. Times without a zone are read in the importer's time zone.
- Importing the same file into the same place again warns first: "You imported [notion-export.zip](http://notion-export.zip) into Support yesterday. Import again?"
- **Undo import** (in the summary, for 7 days) moves everything the import made to Trash as one entry. Pages changed since then are listed first and kept unless "Remove them too" is ticked.

### 3.2 Import: sources

| Source | Files | What you get |
| --- | --- | --- |
| Text and Markdown | .md, .txt, or a .zip of them with pictures | One page per file (title from the first heading or the file name); folders become parent pages. Markdown is read as in pasting (Pages and blocks 3.8), plus tables, footnotes (added as a Notes list at the end) and TeX math (equation blocks) |
| HTML | .html, or a .zip with pictures | Headings, lists, tables, quotes, code, pictures, links, and details sections as toggles |
| Word | .docx | Headings from Word's heading styles, lists, tables, pictures, links and footnotes. Tracked changes come in as accepted; Word comments aren't brought in |
| Google Docs | A Docs file downloaded as Word (.docx) | As Word |
| CSV and Excel | .csv, .tsv, .xlsx | A database, with the preview and rules of Databases section 3.7 |
| Notion export | The .zip from Notion's "Markdown and CSV" or "HTML" export | The page tree; databases from their CSV files with each row's page content; files; links between pages. Property types are guessed as in CSV import; formulas and rollups come in as text with their last values, listed as problems |
| Evernote | .enex (one or more notebooks) | A page per notebook with each note as a sub-page, or "As a database" with tags as a multi-select and the created and updated dates as properties. Checkboxes become to-dos; attachments become files |
| Confluence | A space exported as HTML (.zip) | The space's page tree; attachments as files; info, note and warning panels as callouts; code macros as code blocks. Other macros become text and are listed as problems |
| Trello | A board's JSON export | A database with a Board view grouped by list: cards as rows, lists as Status options, labels as a multi-select, due dates, members (matched as above), descriptions and checklists as page content, and attachment links. Archived cards only with "Include archived" |
| Asana | A project's CSV export | A database: task name, assignee, due date, section as a select, tags, notes as page content, and a "Parent task" relation for subtasks |

- Blocks that have no Care Hub match become text or a link, and each kind is listed once in the problems ("12 Jira embeds kept as links").

### 3.3 Export

- **What's included:** only what the exporter can open; hidden properties and rows they can't see are left out (Databases); pages in Trash never. With Include sub-pages, sub-pages they can't open are skipped and counted in a README file in the export.
- **Markdown and CSV:** each page as a .md file starting with its title as a heading and its properties as "Name: value" lines; databases as CSV (Databases section 3.8) plus a folder with each row's page as Markdown. Toggles become bullets with their content indented; callouts become quotes starting with the icon; columns come one after another; synced blocks as their content; equations as TeX between `$$`; mentions and links to exported pages as relative links, others as Care Hub links. Files go in a folder next to the page with relative links, so the export works offline.
- **HTML:** one file per page with its styling inside (no scripts), files in folders, and working links between exported pages.
- **PDF:** made on the ThinkCentre with the same layout as Print: colors, callouts, code with highlighting, tables split across pages by row, pictures never split. Inline databases show the chosen view as a table. Videos, audio and embeds show as links.
- **Print:** prints the page as shown (toggles as they are, unless Open all toggles), without the sidebar, top bar, comments or buttons. Long tables repeat their header row on each page.
- **File names:** the page title, with characters that aren't allowed in file names replaced by "-", trimmed to 100 characters, and numbered when two are the same ("Refund steps (2).md").
- **Small exports** (up to 50 pages and 100 MB) download at once. Bigger ones run in the background; when they're ready, the person gets a 🔔 notice with a download link that works only for them, for 7 days (as in Data settings). Downloading asks for the password again after 15 minutes (Settings and members).
- **Whole workspace:** Settings → General → Export all content is Data settings → Export everything (site admins). Anyone can use Export my content (Data settings).
- **Turned off:** when members can't export (Settings → Security) or a space doesn't allow it, Export and the database CSV export are hidden for everyone but Admins, and direct requests are refused (403). Print still works, since a browser can always print what's on screen.
- Every export is recorded in the Security log: who, what, format, size and when.

## 4. Data it stores

- **Import:** who, source, file name and size, destination, options, status (waiting, running, done, failed, cancelled, undone), progress, counts, the problem list, everything it made (for Undo), started and finished.
- **Export:** who, what (page, database or view, with options), format, status, the file and its size, link expiry, downloads (when), started and finished.
- Uploaded import files are deleted after the import finishes or fails; export files when their link expires.

## 5. Permissions

| Action | Needs |
| --- | --- |
| Import as new pages or databases | The Create permission, and Can edit where it goes |
| Import CSV into an existing database | As in Databases |
| Undo an import | The person who imported it |
| Export a page or database | Can view, and export allowed by Settings → Security and the space |
| Print | Can view |
| Export all content | Site admin (Data settings) |
| Download an export | The person who made it, within 7 days |

- Imports and exports never give anyone more access: imported pages get the access of where they're put, and exports contain only what the exporter can open.

## 6. Keyboard and phone

- The import grid and the export dialog work by keyboard (arrow keys between sources, Enter to choose, Tab between options). Drop areas have a "Choose a file" button too.
- Progress is announced every 25% and at the end ("Import finished. 1,204 pages, 3 problems.").
- **Phone:** imports of Markdown, text, Word, CSV and Excel files from the phone's files; big imports are best done on a computer and the dialog says so. Export works and downloads to the phone; Print uses the phone's print or save-as-PDF.

## Done means

Try these in the browser with fictional data. ⭐ marks what the team will notice first. Each check uses its acceptance-check ID from section 7, so tests, results and Friday's list use the same IDs.

1. ⭐ **IE-04** Import a Notion export with 3 databases. → The page tree, the databases with row pages and the links between pages come back; formulas are listed as problems.
2. ⭐ **IE-01** Import a Markdown zip with folders and pictures. → A page tree with pictures, and links between the files point to the new pages.
3. ⭐ **IE-02** Import a Word file with headings, a table, pictures and links. → They all come in, and tracked changes arrive accepted.
4. ⭐ **IE-12** Export a page with sub-pages and a database as Markdown and CSV, then unzip it. → It opens offline with working links and pictures.
5. **IE-11** Choose Undo import. → Everything it added goes to Trash as one entry.
6. **IE-13** Export a page as PDF. → Colors are kept, and no picture is split across two pages.
7. **IE-15** Export a space with 2,000 pages. → It runs in the background, and a 🔔 notice brings the download.
8. **IE-16** Turn off "members can export" as an Admin. → Members no longer see Export, and Print still works.

## 7. Acceptance checks

- **IE-01** A Markdown zip with folders and pictures becomes a page tree with pictures; links between the files point at the new pages.
- **IE-02** A Word file keeps headings, lists, tables, pictures, links and footnotes; tracked changes come in accepted.
- **IE-03** An HTML file with a script, a form and an iframe comes in without them.
- **IE-04** A Notion export with 3 databases recreates the page tree, the databases with row pages, and the links between pages; formulas are listed as problems.
- **IE-05** An Evernote file with 2 notebooks makes 2 pages of notes, or a database with tags and dates when "As a database" is picked.
- **IE-06** A Confluence space export keeps its tree, attachments and panels as callouts.
- **IE-07** A Trello board becomes a Board view grouped by its lists with labels, due dates, members and checklists.
- **IE-08** An Asana CSV gives tasks with assignees, due dates and a Parent task relation.
- **IE-09** A program inside a zip is refused and listed; a photo's location data is removed; a 150 MB file inside is refused with the limit.
- **IE-10** Mentions are matched by email, then name; unmatched become text; no notices are sent.
- **IE-11** Cancel removes what was added; Undo import moves it all to Trash as one entry and lists pages changed since.
- **IE-12** Markdown and CSV export of a page with sub-pages and a database opens offline with working relative links and pictures.
- **IE-13** HTML export has no scripts and its links work offline; PDF export keeps colors and never splits a picture.
- **IE-14** Exports leave out pages the exporter can't open, hidden properties and rows they can't see, and Trash.
- **IE-15** A 2,000-page export runs in the background and sends a 🔔 notice; the link works only for its maker and stops after 7 days.
- **IE-16** With "members can export" off, Export is hidden for members and refused (403); Admins can still export; Print works.
- **IE-17** Every export shows in the Security log.
- **IE-18** Everything works by keyboard and screen reader; axe finds no serious problems; the phone layout works.

## Decisions for Felipe

- 🟨 **IE-D1** Importers that sign in to another service (Notion, Confluence, Trello, Asana or Google Drive) instead of using their export files. They'd need outside connections and stored keys, which the builder rules avoid. **Default:** no; files only.
