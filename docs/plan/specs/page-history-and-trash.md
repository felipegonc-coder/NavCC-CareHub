# Page history and Trash

_Copied from the Notion spec on 2026-10-27. If they differ, Notion wins._

> 🕘 Phase 1 · Notion parity · Depends on: Pages and blocks, live co-editing, Roles and permissions · Used by: Databases (row history, deleted rows), Import and export (undo import), Sidebar (Trash entry), Search (Search in Trash) · Periods set in Data settings

## 1. What it's for

Nothing is lost by mistake. Care Hub keeps versions of every page that people can look back at and restore, shows what happened on a page in its Updates panel, keeps deleted pages, databases and rows in Trash for a while, and lets people archive pages they want to keep but not see every day.

## 2. Screens and states

- **Version history** (page menu → Version history, people with Can edit): the page preview fills the left and a list of versions sits on the right, newest first, grouped by day: "Today, 3:12 PM · Avery Lin, Sam Ortiz", with named versions in bold. Picking one shows that version read-only. "Show changes" (on by default) marks what's different from the version before it: added text in green, removed text struck through in red, changed blocks with a bar in the margin. Buttons: Restore this version, Name this version, Copy link.
- **Updates panel** (page menu → Updates, or the 🕘 in the top bar; Can view): a timeline of what happened on the page: created, edited ("Sam Ortiz edited · 3 changes" with Show changes), renamed, moved, shared, locked, comments, suggestions accepted, property changes on rows ("Status: Open → Done"), restored, archived. Grouped per person and hour, newest first, 50 at a time.
- **Trash** (sidebar bottom, or drop a page on Trash): a window with a search box, filters (Deleted by, In space, Type: Pages, Databases, Rows) and the items the person can restore, newest first. Each item: icon, title, where it was ("Support › Policies"), "and 12 sub-pages", who deleted it and when, "Deletes in 12 days", and the buttons Restore and Delete forever. Checkboxes allow restoring or deleting several at once.
- **Archived** tab in the same window: archived pages and databases the person can open, with who archived them and when, and Unarchive.
- **A page in Trash** (opened by a link): "This page is in Trash." with Restore and Delete forever (Pages and blocks); no editing.
- **An archived page:** the yellow banner "Archived by Sam Ortiz on Oct 20, 2026 · Unarchive" (Pages and blocks); read-only.

| State | What shows |
| --- | --- |
| No versions yet | "Versions appear here after the first edits." |
| Trash empty | "Trash is empty. Deleted pages stay here for 30 days." (the period from Data settings) |
| Nothing matches | "Nothing in Trash matches." with Clear filters |
| Restoring | The item fades with "Restoring…"; large items finish in the background with a 🔔 notice |
| Restore failed | "Couldn't restore Refund steps. Try again." The item stays in Trash |
| Version can't open | "This version is too old to show (deleted under the Data settings period)." |

## 3. Behavior and edge cases

### 3.1 Versions

- **Automatic versions:** while a page is being edited, Care Hub saves a version after 2 minutes without edits, and at least every 10 minutes during long sessions. One version covers everyone who edited in that stretch.
- **Extra versions** are saved right before a restore, an import into the page, applying a template to it, Replace all, and Accept all suggestions (Comments and mentions).
- **Named versions:** "Name this version" (for example "Before the Nov policy change") keeps that version forever, whatever the Data settings period. Up to 100 per page; the name can be changed or removed.
- Each version holds the title, icon, cover, page style and all content (blocks, text and their settings). It doesn't hold comments, access, sub-pages' content, or rows of databases inside the page; those have their own history.
- Versions older than the Data settings period are deleted at night, except named versions (Data settings, DS-01).
- Row pages have versions too; their property changes show in Updates (Databases).

### 3.2 Restoring a version

- Restore this version asks: "Replace the current page with the version from Oct 20, 3:00 PM? The current page is saved as a version first." Restore or Cancel.
- The restore is one new change: people editing at that moment see the content change and a note "Avery Lin restored a version from Oct 20, 3:00 PM." Anything typed in the meantime is in the version saved just before the restore.
- Sub-page and database blocks come back as they were. If the old version links a sub-page that is now in Trash, the block shows "In Trash" with Restore; restoring a version never restores or deletes other pages.
- Comments on text that the restore brings back reattach to it (Comments and mentions).
- **Copy from a version:** select blocks in the preview and copy them (Ctrl+C) to paste into the current page, instead of restoring everything.
- A locked page must be unlocked first. A restore can be undone by restoring the version saved just before it.

### 3.3 Updates panel

- Shows edits, renames, moves, sharing changes, locks, comments, suggestions, property changes, restores, archiving and moves to Trash for this page.
- Entries never show anything the person can't see: changes to hidden properties are left out, and moves into or out of pages they can't open show "a page you can't open".
- "Show changes" opens Version history at that point (Can edit). Viewers see who did what and when, without the content.
- Entries are kept as long as the automatic versions (Data settings).

### 3.4 Trash

- **Moving to Trash** (page menu, block menu on a page block, sidebar menu, dragging onto Trash, or Delete on rows and databases) takes the item and everything inside it (sub-pages, databases and rows) in one Trash entry, and shows "Moved to Trash · Undo" for 8 seconds.
- Things in Trash don't show in the sidebar, search, views, Home, Calendar, backlinks or relation pickers. Links and mentions to them show grey with a line through (Pages and blocks), and relations to deleted rows are hidden until restore (Databases).
- **Restore** puts the item back where it was, at the same position, with its access, comments, history and sub-pages. If the place it came from is in Trash or gone, Care Hub asks: "Policies is in Trash too. Restore it as well, or move Refund steps somewhere else?" Restore both, Move to… or Cancel. A row whose database is in Trash asks to restore the database first (Databases).
- **Delete forever** asks "Delete Refund steps and 12 sub-pages forever? This can't be undone." The item, its versions, comments and files go at once (files that are still used elsewhere stay). Backups keep it for up to 30 more days (Data settings).
- **Automatic delete:** items older than the Trash period (Data settings; 30 days by default) are deleted forever at night. Items show "Deletes in 12 days"; the last 3 days are shown in red.
- **Who sees an item in Trash:** the person who deleted it and people with Full access on it at the time it was deleted. Admins also see items from spaces they're members of. Nobody sees someone else's private pages.
- Deleting a whole space follows the Sidebar spec: the space and all its pages become one Trash entry.

### 3.5 Archive

- **Archive** (page menu, Full access) is for pages and databases that are done but worth keeping. The page and its sub-pages become read-only, leave the sidebar tree, and are left out of search unless Include archived is on (Search). Links and mentions still open them, with the banner.
- Archived pages don't get reminders, review notices (Knowledge base) or automation runs; their databases stop taking form responses ("This form is closed.").
- **Unarchive** (banner or the Archived tab, Full access) puts everything back where it was. Archiving or unarchiving a page that has sub-pages says how many.
- Single rows can't be archived; use a property or Trash. Archived spaces are handled in Sidebar and Settings → Spaces.

## 4. Data it stores

- **Version:** page, kind (automatic, named, before restore, before import, before template, before replace, before automation), name, people who edited, created at, size, and the content (stored as the changes since the previous version, with a full copy every 20 versions).
- **Update entry:** page, person, kind, details (for example old and new title, property, old and new value), version it belongs to, when.
- **Trash entry:** item (page, database, row or space), deleted by and when, where it was (parent and position), number of sub-pages and rows, delete-forever date.
- **Archive:** page, archived by and when.
- Cleanups follow the Data settings periods and are recorded there.

## 5. Permissions

| Action | Needs |
| --- | --- |
| See the Updates panel | Can view |
| See version history, show changes, copy from a version | Can edit |
| Restore or name a version | Can edit (and the page isn't locked) |
| Move to Trash, archive, unarchive | Full access (Pages and blocks) |
| See an item in Trash and restore it | The person who deleted it, or Full access on it when it was deleted |
| Delete forever | Full access on it when it was deleted |
| Set the Trash and version periods | Admin settings permission (Data settings) |

- A direct request for a version, an Updates entry or a Trash entry without the access above is refused (403), and the response has no title.

## 6. Keyboard and phone

- In Version history, ↑ and ↓ move between versions, Enter restores (after the confirm), and Esc closes. Ctrl+Alt+H opens it from the page.
- In Trash, the search box has focus on open; ↑ and ↓ move, Enter opens the item read-only, and Tab reaches Restore and Delete forever. Screen readers hear "Refund steps, in Support › Policies, deleted by Sam Ortiz yesterday, deletes in 29 days".
- Changes in Show changes are announced as "added" and "removed", not only by color.
- **Phone:** Version history shows the list first and the preview full screen after a tap; Trash and Updates are full screens; swipe left on a Trash item for Restore and Delete forever.

## Done means

Try these in the browser with fictional data. ⭐ marks what the team will notice first. Each check uses its acceptance-check ID from section 7, so tests and results use the same IDs.

1. ⭐ **HT-01** Edit "Refund steps" for a minute, wait 2 minutes, then open Page history. → One new version, with your name on it.
2. ⭐ **HT-09** Move "Policies" and its sub-pages to Trash, press Undo, then trash it again and restore it from Trash. → Each time it comes back in the same place, with its sub-pages and comments.
3. ⭐ **HT-05** Restore an older version while Sam is typing. → The page goes back; Sam's text is in the version saved just before, and both see the note.
4. **HT-04** Open an older version and turn on Show changes. → Added, removed and changed blocks are marked.
5. **HT-07** Copy two blocks from an old version and paste them into the page. → They keep their formatting.
6. **HT-10** Restore a page whose parent is in Trash. → Restore both, Move to… and Cancel are offered, and each works.
7. **HT-14** Archive a page, then unarchive it. → It turns read-only and leaves the sidebar and search, then comes back.
8. **HT-08** Open Updates on a busy page. → Edits, renames, moves, sharing and comments show with names and times.

## 7. Acceptance checks

- **HT-01** Editing for a minute and pausing for 2 minutes saves one version naming everyone who edited; an hour of non-stop typing saves at least 6.
- **HT-02** Restore, import, applying a template, Replace all and Accept all each save a version first.
- **HT-03** A named version survives the night after the version period is shortened to 30 days; unnamed older ones are gone.
- **HT-04** Show changes marks additions, removals and changed blocks in color and for screen readers.
- **HT-05** Restoring a version while another person types keeps their text in the version saved just before; both see the note.
- **HT-06** Restoring never deletes or restores sub-pages; a sub-page in Trash shows "In Trash" with Restore.
- **HT-07** Blocks copied from an old version paste into the current page with their formatting.
- **HT-08** Updates shows edits, renames, moves, sharing, comments and property changes, and never shows a hidden property or the title of a page the person can't open.
- **HT-09** Moving a page with 12 sub-pages to Trash makes one entry; Undo within 8 seconds puts it back; restore later puts it back in the same place with its access and comments.
- **HT-10** Restoring a page whose parent is in Trash offers Restore both, Move to… and Cancel, and each works.
- **HT-11** Delete forever removes the page, its versions and its files not used elsewhere; the Data settings storage numbers drop by the next hourly update.
- **HT-12** Items older than the Trash period are deleted forever at night; "Deletes in" is right and turns red in the last 3 days.
- **HT-13** Trash shows only items the person deleted or had Full access to; another person's private page never shows, even to an Admin.
- **HT-14** Archiving makes the page and sub-pages read-only, hides them from the sidebar and search (unless Include archived), stops reminders and review notices, and closes forms; Unarchive undoes all of it.
- **HT-15** Without the needed access, direct requests for versions, Updates entries, restores and deletes are refused (403).
- **HT-16** Everything works by keyboard and screen reader; axe finds no serious problems; the phone layout works.
