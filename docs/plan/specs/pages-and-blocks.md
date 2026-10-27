# Pages and blocks

_Copied from the Notion spec (https://app.notion.com/p/2e1234682f1d4e23b29b18fbbf5d8ecf) on 2026-10-27. If they differ, Notion wins._

> 🧱 Phase 1 · Notion parity · Depends on: accounts, file storage and live co-editing (Phase 1) · Used by: every spec that shows page content · Related: Comments and mentions, Page history and Trash, Templates and buttons, Import and export, Sidebar, spaces and nested pages

## 1. What it's for

Pages are documents made of blocks: text, lists, media, databases and more. This spec covers every block type and option Notion has, plus Care Hub's own tabs block, so people can write and arrange anything they could in Notion.

## 2. Screens and states

**Page screen**

- **Top bar:** breadcrumbs (space › parent pages › page; the middle folds into "…" past 4 levels), people here now (up to 5 pictures, then "+3"), "Edited 2m ago" (hover shows who and when), Share, Comments (opens the comments panel), ☆ Favorite, and "…" (the page menu, section 3.2).
- **Header:** icon, cover and title. Hovering the title area shows Add icon, Add cover and Add comment when they're missing. Database rows also show their properties (see Databases).
- **Body:** the blocks, in the text column (about 768 px wide, or the whole width with Full width). Hovering a block shows **+** (add a block below; Alt-click adds above) and **⋮⋮** (drag; click for the block menu) to its left.
- **Pop-ups:** "/" menu, block menu, selection toolbar, "@" menu, ":" emoji menu, link editor, color menu, Move to dialog and picture viewer.
- **New empty page:** under the title: "Press Enter to start writing, or start with:" Templates · Import · Table · Board · List · Calendar · Gallery · Timeline · Chart · Form. Typing or pressing Enter hides these.

**States**

| State | What shows |
| --- | --- |
| Loading | The top bar and 6 grey lines (only after 300 ms) |
| Empty block with the cursor in it | "Type '/' for commands" in faint text |
| View only (Can view or Can comment) | A "View only" chip in the top bar; no + or ⋮⋮; text can still be selected and copied, toggles and tabs opened |
| Locked | Banner "🔒 Locked by Avery Lin · Unlock" (Unlock only for Can edit or more) |
| Reconnecting | "Reconnecting…" in the top bar; typing goes on (section 3.12) |
| In Trash | "This page is in Trash." with Restore and Delete forever (Full access); no editing |
| Archived | Yellow banner "Archived by Sam Ortiz on Oct 20, 2026 · Unarchive" (see Page history and Trash) |
| Moved to Trash while open | "Sam Ortiz moved this page to Trash." with Restore (if allowed); editing stops at once |
| Uploading | A progress bar in the block; a failure shows "Upload failed · Retry · Remove" |
| No access, not found | As in the shared rules |

## 3. Behavior and edge cases

### 3.1 Pages

- **Title:** plain text and emoji, up to 2,000 characters; empty shows "Untitled". A new page opens with the cursor in its empty title. Enter in the title moves to the first block, making one if needed. A rename updates every link, mention, breadcrumb, sidebar entry and browser tab live. The browser tab shows the page icon and title.
- **Icon:** an emoji (search, categories, recently used, skin tone), an icon from the icon set in one of 10 colors, a custom workspace emoji, or an uploaded picture (PNG, JPEG, GIF or WebP up to 5 MB, cropped to a square). Also Random and Remove.
- **Cover:** a picture from Care Hub's own gallery (colors, gradients and patterns), or an upload (PNG, JPEG, GIF or WebP up to 10 MB). Change, Reposition (drag up or down; the position is saved) and Remove. 280 px tall on computers, 160 px on phones.
- **Sub-pages** live in their parent's content as page blocks. Every page has exactly one home: a space, a parent page, or a database (as a row). There's no depth limit.
- **Links never break:** link-to-page blocks, @mentions and text links follow renames and moves. A link to a page in Trash shows grey with a line through it; restoring the page brings the link back.
- **Backlinks:** "3 backlinks" under the title lists the pages that link to or mention this one, only those the viewer can open. Customize page sets it to Show under the title (default), Show in a pop-up, or Off.
- **Page style** (page menu): Font (Default, Serif or Mono), Small text (body 14 px), Full width, Text direction (left to right, or right to left for Arabic or Hebrew) and **Customize page**: backlinks (as above), page comments (shown at the top, or Off) and a floating table of contents on the right of screens at least 1,280 px wide (on or off; off by default).
- **Lock page:** stops all editing, for everyone, until someone with Can edit unlocks it. Comments still work.
- **Page info** (bottom of the page menu): word count, character count, created by and when, last edited by and when.
- **Presence:** the pictures of people who have the page open show in the top bar. While someone types, their cursor and selection show in their color with their first name. Both disappear within 10 seconds after they leave.

### 3.2 Page menu ("…")

Style (section 3.1) · Lock page · Copy link · Duplicate (Ctrl+D) · Move to · Move to Trash · Archive · Remind me (Home and reminders) · Follow (Comments and mentions) · Version history and Updates (Page history and Trash) · Save as template (Templates and buttons) · Turn into knowledge base page (Knowledge base) · Import · Export · Print (Import and export) · Analytics (Admins only) · Page info. Items the person can't use are hidden.

- **Duplicate** copies the page with its sub-pages, databases (with rows), files and style, named "\[title\] (copy)", placed right after the original. Links inside the copy that pointed at copied pages point at the new copies. Comments, history, reminders and analytics aren't copied. Large copies run in the background ("Duplicating 340 pages…"), and a 🔔 notice says when it's done.
- **Move to:** search pages and spaces where you can edit; the page moves there with its sub-pages. If that changes who can open it, the confirm from Roles and permissions (section 3) shows first, for example "Moving Refund steps to Billing changes who can open it: 4 people lose access; the Agents group gets Can view." 🆕 When Settings → Security and the space allow it, Move to also lists the person's other workspaces: the page, its sub-pages and files are copied there and moved to Trash here. Comments, history and access don't come along, and mentions of people who aren't in the other workspace become plain text.

### 3.3 Blocks in general

- Every block has an ID that never changes. **Copy link to block** gives the page link plus the block's ID; opening it scrolls to the block, opens any toggle or tab around it, and highlights it for 2 seconds.
- **Block menu** (click ⋮⋮, right-click, or Ctrl+/): a search box, then Turn into, Color, Copy link to block, Duplicate, Move to, Delete, Comment, the type's own options, and "Last edited by Avery Lin · 3:12 PM" at the bottom.
- **Colors:** 10 text colors and 10 backgrounds: Default, Gray, Brown, Orange, Yellow, Green, Blue, Purple, Pink and Red. Each has a light-mode and a dark-mode value that keeps text contrast at 4.5:1 or more. The names also work in "/" ("/red", "/blue background", "/default").
- **Turn into:** text-like blocks change into each other and keep their text, inline formatting and children: Text, Heading 1–3, To-do, Bulleted list, Numbered list, Toggle list, Toggle heading 1–3, Quote, Callout, Code (formatting is dropped) and Page (the text becomes the title and the children its content). A page block can turn into a mention and back.
- **Nesting:** Tab puts a block inside the block above when that block can hold children (text, the three lists, to-do, toggles, toggle headings, quote and callout). Shift+Tab takes it out. Up to 20 levels: a top-level block is level 1, so a block can be nested 19 times at most. Tab does nothing when it would put the block, or anything inside it, past level 20. Columns, tabs blocks and synced blocks don't count as levels, and pasted or imported content nested deeper lands at level 20.
- **Selecting:** Esc selects the block the cursor is in; Shift+↑ and Shift+↓ grow the selection; Ctrl+A selects the block's text, then all blocks; dragging in the margin draws a selection box; Shift-click selects a range. Selected blocks can be deleted, duplicated, moved, colored, turned into another type, copied, cut, indented and dragged together.
- **Dragging:** drag ⋮⋮ to move blocks; a blue line shows where they'll land. Dropping at the left or right edge of a block makes columns. Dropping on a page block, a link to page or a page in the sidebar moves the blocks to the end of that page. Alt-drag copies instead of moving. Files dropped from the computer become picture, video, audio, PDF or file blocks where they land.
- **Moving by keyboard:** Ctrl+Shift+↑ and Ctrl+Shift+↓ move the selected blocks up and down, also into and out of toggles and columns. Move to sends them to the end of another page.
- **Backspace:** in an empty block, deletes it and moves up; at the start of a text block, joins it to the block above; at the start of a heading, list item, quote or callout, first turns it into text. Deleting a page block asks first and moves that page to Trash, which needs Full access on it ("You need Full access to 'Refund steps' to delete it.").
- **Undo and redo:** Ctrl+Z and Ctrl+Shift+Z (and Ctrl+Y on Windows) undo your own changes only, never other people's, back to when you opened the page. Right after a Markdown shortcut or auto-format, Ctrl+Z turns it back into what you typed.
- **Limits:** pages stay fast up to 5,000 blocks. Past 20,000 blocks, adding more is refused: "This page is too long. Move some of it into a sub-page." One text block holds up to 20,000 characters; longer pastes are split at line breaks.

### 3.4 Block catalog

**Basic blocks**

| Block | Add with | Options and rules |
| --- | --- | --- |
| Text | "/text", or just type | Shift+Enter adds a line break inside the block. |
| Page | "/page" | Shows the page's icon and title; click to open. Making one opens the new page. Cut and paste moves the page; copy and paste makes a link to page. |
| To-do list | "/todo", `[]` | A tick box. Ticked items turn grey with a line through. Ctrl+Enter ticks and unticks. Children are separate to-dos. |
| Heading 1, 2, 3 | "/h1", "/h2", "/h3", `#`, `##`, `###` | 30, 24 and 20 px. They feed tables of contents and can be linked to. Screen readers hear them as levels 2, 3 and 4 (the page title is level 1). |
| Bulleted list | "/bullet", `-`, `*` or `+` | The bullet changes with depth (•, ◦, ▪). Enter on an empty item ends the list. |
| Numbered list | "/numbered", `1.`, `a.` or `i.` | Numbers continue through neighbouring items. The style (numbers, letters, Roman numerals) changes with depth unless set in the block menu; Start at sets the first number. |
| Toggle list | "/toggle", `>` | Click the arrow or press Ctrl+Enter to open or close. Open or closed is remembered per person. An open empty toggle says "Empty toggle. Click or drop blocks inside." Ctrl+Alt+T opens or closes every toggle on the page. |
| Toggle heading 1, 2, 3 | "/toggle heading", or Turn into | A heading that folds the blocks nested under it, with the toggle rules. |
| Quote | "/quote", `"` | A bar on the left; can hold children. |
| Callout | "/callout" | An icon (emoji, icon, upload or none) and a background (Gray unless changed). Holds any blocks, including columns. |
| Divider | "/divider", `---` | A thin line. |
| Link to page | "/link to page", `[[` | Pick a page. Looks like a page block with ↗, but the page stays where it lives. |
| Table | "/table" | A simple table of formatted text, up to 1,000 rows and 50 columns. Options: header row, header column, fit to page width. Hover bars add a row or column; drag a row or column by its handle; drag column edges to resize. Shift+arrows select cells to color, clear, copy, or paste a block from a spreadsheet. "Turn into database" makes an inline database from it (the first column becomes Name). |
| Columns | "/columns" (2, 3, 4 or 5), or drag beside a block | Drag the gap to resize. Columns can't go inside other columns. Removing all but one column removes the layout. Below 768 px wide, columns stack top to bottom. |
| Tabs (Care Hub) | "/tabs" | A row of tabs, each holding its own blocks; starts with "Tab 1" and "Tab 2". Each tab has a name and an optional icon; label size small, default or large. "+" adds a tab; drag to reorder; double-click renames; right-click or the tab's "…" gives Rename, Icon, Duplicate, Move left, Move right and Delete (asks first if it has content). The open tab is remembered per person, and a link to a block inside a tab opens that tab. Up to 20 tabs. On phones the tab row scrolls sideways. |

**Media**

| Block | Add with | Options and rules |
| --- | --- | --- |
| Image | "/image", or paste or drop a picture | Upload, or a web address that Care Hub downloads and keeps (🟨 PB-D3). PNG, JPEG, GIF, WebP, AVIF, HEIC (shown as JPEG) and SVG (shown only as a picture, never as page code). Location data is removed. Options: Caption, Description for screen readers (asked after uploading; can be skipped), Align (left, center, right), size (drag a side handle; 10–100% of the column), Replace, Download, View original. A click opens the viewer: zoom, ← and → through the page's pictures, Download, Esc to close. Big pictures get smaller copies for speed; the original is kept. |
| Video | "/video" | Upload (MP4, WebM, MOV) or a YouTube, Vimeo or Loom link. Player controls; never plays by itself. Caption, size, align, Download (uploads), Open original. |
| Audio | "/audio" | Upload (MP3, M4A, WAV, OGG, WebM). Player, caption, Download. |
| File | "/file" | Any allowed file (see Data settings). Type icon, name and size; Download; Rename (the name shown); Caption. |
| PDF | "/pdf" | Upload, or a link (downloaded). A viewer with page arrows and zoom, 300–1,200 px tall (drag the bottom edge). Open in new tab, Download, Caption. |
| Web bookmark | "/bookmark", or paste a link and pick Bookmark | A card with the page's title, description, site icon and picture, fetched by the server (section 3.10). Refresh, Caption. If nothing can be fetched, the card shows the address and "No preview". |
| Embed | "/embed", a site's own name ("/figma"), or paste a link and pick Embed | Only sites on the approved list (section 3.10). Drag the bottom edge for height (100–1,600 px) and a side handle for width. Caption, Open original, Turn into bookmark or link. |
| Code | "/code", three backticks | Language (about 50, including Plain text and Mermaid; Plain text by default, then the last one used), syntax colors, Wrap lines, Line numbers, Caption, Copy. Tab and Shift+Tab indent inside the block; Esc leaves it. Mermaid shows Code, Preview or Split; a broken diagram shows its error under the code. Code is never run. |

**Database blocks** (all behavior in Databases and Forms)

| Block | Add with | What it does |
| --- | --- | --- |
| Table, Board, List, Gallery, Calendar, Timeline, Chart, Feed, Dashboard view | "/table view", "/board view"… | Makes a new inline database with that view. |
| Form | "/form" | Makes a new inline database with a Form view. |
| Database, full page | "/database full page" | Makes a new database as a sub-page. |
| Linked view of database | "/linked view" | Shows an existing database here with its own views. |

**Advanced blocks**

| Block | Add with | Options and rules |
| --- | --- | --- |
| Table of contents | "/toc" | Lists the page's headings and toggle headings, indented by level; click to jump. Updates live. Color option. Moves and deletes as one block. |
| Block equation | "/equation", `$$` | TeX, drawn with KaTeX. Click to edit with a live preview; Ctrl+Enter or Esc closes. A broken equation shows "Invalid equation" and keeps the text. |
| Button | "/button" | Runs actions when clicked. See Templates and buttons. |
| Breadcrumb | "/breadcrumb" | Shows where this page lives, each part clickable. |
| Synced block | "/synced block", or Copy and sync in the block menu | See section 3.9. |
| Meeting notes | "/meeting notes" | See Meetings. |

**Inline** (inside any text)

| Item | Add with | What it does |
| --- | --- | --- |
| Mention a person | "@" and a name | A chip with the person's name; tells them (see Comments and mentions). |
| Mention a page | "@" or `[[` and a title, or paste a Care Hub link | A chip with the page's icon and live title; makes a backlink. Block links show as "Page › block text". |
| Date or reminder | "@today", "@tomorrow", "@next Monday", "@Oct 30 3pm", "@remind…" | A date chip in the viewer's format and time zone. Clicking opens a picker: date, time, end date, and a reminder (section 3.7). |
| Emoji | ":" and at least 2 letters, or the emoji button | The emoji picker; custom workspace emoji included. |
| Inline equation | Ctrl+Shift+E, or `$`  • text + `$` | TeX in the line of text. |
| Link mention | Paste a web link and pick Mention | A chip with the site icon and page title (fetched like a bookmark). |

### 3.5 Text formatting and links

- **Formatting:** bold, italic, underline, strikethrough, inline code, text color, background color, link, inline equation and comment. Selecting text shows a toolbar: Turn into ▾, Link, Comment, B, I, U, S, Code, Equation, Color ▾ and "…" (Copy link to block, Mention, Ask Claude in Phase 5). Inline code ignores other formatting.
- **Links:** to web addresses (http, https, mailto and tel only; anything else is refused) or to Care Hub pages and blocks. Ctrl+K with text selected opens the link editor: paste an address, or type to search pages. Hovering a link shows its address with Copy, Edit and Remove. Clicking opens it: web links in a new tab, Care Hub links in the same tab (Ctrl-click: new tab).
- **Auto-format while typing:** `**bold**`, `*italic*` or `_italic_`, `~strike~`, text between two backticks (code), and arrows and dashes: `->` becomes →, `<-` ←, `<->` ↔, `=>` ⇒, `--` — . Ctrl+Z right after undoes it.

### 3.6 The "/" menu and Markdown shortcuts

- "/" opens a menu at the cursor; typing filters by name and other names ("/h2", "/todo", "/img", "/db"). Groups: Suggested (your 5 most recent), Basic blocks, Media, Database, Advanced, Inline, Embeds, then Actions (Delete, Duplicate, Move to, Comment, Turn into…, colors). ↑ ↓ and Enter pick; Esc closes and keeps the typed text; "No results" after 3 extra letters with no match, then the menu closes.
- Markdown shortcuts at the start of a block, followed by a space: `#`, `##`, `###`, `-`, `*`, `+`, `1.`, `a.`, `i.`, `>` (toggle), `"` (quote), `$$` (equation). These work without a space: `[]` (to-do), `---` (divider), three backticks (code).
- The page also accepts pasted Markdown (section 3.8).

### 3.7 Dates and reminders in text

- A date chip holds a date, an optional time and an optional end. Words are understood while typing: today, tomorrow, yesterday, now, weekdays ("next Friday"), and dates and times in the formats from the shared rules ("Oct 30", "10/30/2026", "3pm").
- Reminder choices: for dates with a time: at the time, 5, 10, 15 or 30 minutes before, 1 hour, 2 hours, 1 day or 2 days before; for dates without a time: on the day at 9:00 AM, 1 day, 2 days or 1 week before at 9:00 AM. The reminder goes to the person who set it, through Home and reminders. A chip with a reminder shows ⏰, and turns red once its time has passed.
- Each viewer sees the chip in their own format and time zone; a date without a time never shifts.

### 3.8 Copy and paste

- **Within Care Hub:** blocks paste exactly as they were (types, colors, children, files). A copied page block pastes as a link to page; a cut page block moves the page. Copying from a page you can only view works; files you copy stay readable only for people who can open their page.
- **To other apps:** the clipboard gets both rich text (HTML) and Markdown as plain text.
- **From other apps (HTML, for example Google Docs, Word, web pages and Notion):** headings, lists, to-dos, quotes, code, tables (as simple tables), links, bold, italic, underline, strikethrough and colors are kept. Pictures inside are downloaded (🟨 PB-D3); ones that can't be fetched become a link. Fonts, sizes and layout are dropped.
- **Plain text:** each line becomes a text block; text that looks like Markdown (headings, lists, to-dos, quotes, code fences, tables, links, bold, italic, code, dividers) is turned into blocks.
- **A web link on its own:** pastes as a link, with a small menu: Mention · Bookmark · Embed (approved sites only) · Dismiss. A Care Hub page link pastes as a page mention.
- Ctrl+Shift+V pastes as plain text. Pasting into a code block always keeps the text exactly.
- A paste larger than 10 MB of text or 2,000 blocks asks first: "This will add 3,450 blocks. Continue?"

### 3.9 Synced blocks

- A synced block shows the same content in several places. The first one is the **original**; the others are copies. An edit in any of them shows in all of them live.
- Make one with "/synced block" (then Copy and sync), or by selecting blocks and choosing Turn into → Synced block. Paste the copy anywhere.
- A thin colored outline shows when hovering or editing, with "Editing in 3 pages" (click for the list, showing only pages the viewer can open).
- **Access:** seeing a copy's content needs Can view on the original's page; otherwise the copy shows "You don't have access to the original block." Editing needs Can edit on both pages.
- **Unsync** (on a copy) turns it into normal blocks there. **Unsync all** (on the original) turns every copy into normal blocks.
- If the original is deleted, the copies show the last content read-only, with "The original was deleted." and Keep as normal blocks (Can edit). Restoring the original reconnects them.
- Synced blocks can't hold other synced blocks.

### 3.10 Embeds and link previews

- **Approved sites** (🟨 PB-D4): Admins manage the list in Settings → Embeds. Each entry is a site and how its links become an embed address (for example, a YouTube watch link becomes its embed link). Starter list: YouTube, Vimeo, Loom, Google Maps, Google Docs, Sheets, Slides, Forms and Drive files, Figma, Miro, Microsoft Forms, Typeform and CodePen.
- An embed shows the site in a sealed frame: it can't reach Care Hub's pages or cookies, can't move the top window, and can only open new tabs. If the site refuses to be framed, the block says "This site doesn't allow embedding." with Open original.
- A link from a site that isn't approved offers Bookmark or Link instead, with "Care Hub can only embed approved sites. Ask an Admin to add this one."
- The server also checks embed addresses when saving and removes any that aren't approved.
- **Fetching previews** (bookmarks, link mentions, downloaded pictures): only the server fetches, only from public internet addresses (never local or Tailscale addresses), over http or https, with no cookies, up to 5 seconds and 2 MB per page (10 MB per picture). Previews are kept and refreshed only when someone clicks Refresh.

### 3.11 Uploads

- Upload by button, paste or drop, several files at once. Each file is checked on the server for its real type and size (the limits are in Data settings). A refused file says why: "Programs can't be uploaded." or "This file is 310 MB; the limit is 100 MB."
- Files are stored on the ThinkCentre and served only to people who can open the page they're on; every file request checks this. Copying a page's link to a file works only for those people.
- A file stays as long as any block, page or version uses it; deleting the last use frees it after Trash and history no longer need it (see Data settings).

### 3.12 Live co-editing and connection drops

- Everyone on the page edits at once; changes merge without conflicts and show for others within 1 second.
- If the connection drops, typing goes on. Changes are kept in the browser and sent when it reconnects, in order, with nothing lost or doubled. "Reconnecting…" shows after 3 seconds.
- Closing the tab with unsent changes asks first. If the browser closes anyway, the changes are sent the next time Care Hub opens on that browser.
- Things that need the server (uploads, embeds, previews, duplicating, moving) wait while offline, with "Waiting for the connection".
- If access changes, editing switches as in Roles and permissions (within 5 seconds, with a banner).

## 4. Data it stores

- **Page:** workspace, space, parent (space, page or database), position among its siblings, title, icon (kind, value, color), cover (picture and position), font, small text, full width, text direction, backlinks display, page comments display, floating contents on or off, locked (by whom, when), created and edited (by whom, when), in Trash (since, by whom), archived (since, by whom), and the fields owned by Templates and Knowledge base.
- **Content:** the page's live document (blocks with their IDs, types, text, formatting and settings, as listed in section 3.4), plus a Markdown copy and plain text for search, export and backups, and the block count.
- **Link index:** from page and block, to page or block, and how (sub-page, link to page, mention, text link, block link, synced copy). Used for backlinks, "links never break" and synced blocks.
- **File:** owner, page, name, real type, size, picture width and height, smaller copies, uploaded at, still used or not.
- **Link preview:** address, title, description, site icon, picture, fetched at.
- **Approved embed sites:** site, link patterns, how to make the embed address, added by and when.
- **Per person:** open or closed toggles, the open tab of each tabs block, recently used blocks, emoji skin tone and recent emoji.

## 5. Permissions

| Action | Needs |
| --- | --- |
| Open and read, select and copy, open toggles and tabs (for yourself), print, export (if Settings allow it) | Can view |
| Comment | Can comment |
| Change blocks, title, icon, cover and page style; upload; add databases; lock and unlock | Can edit |
| Move to Trash, archive, move, share | Full access (moving also needs Can edit where it goes) |

- The live editing connection opens read-only for Can view and Can comment. Any change sent over it is refused (403) and the connection is closed.
- The server checks every saved change: embeds must be approved, files must belong to pages the person may use, and links must be allowed kinds. Anything else is removed and logged.

## 6. Keyboard and phone

**Shortcuts** (Ctrl means Cmd on a Mac)

| Keys | Does |
| --- | --- |
| Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+S | Bold, italic, underline, strikethrough |
| Ctrl+E · Ctrl+Shift+E | Inline code · inline equation |
| Ctrl+K (with text selected) | Link |
| Ctrl+Shift+H | Apply the last color used |
| Ctrl+Shift+M | Comment |
| Cmd+Option+0–9 on Mac, Ctrl+Shift+0–9 on Windows and Linux | Turn into: 0 text, 1–3 headings, 4 to-do, 5 bulleted, 6 numbered, 7 toggle, 8 code, 9 page |
| Ctrl+Enter | Tick a to-do, or open or close a toggle |
| Ctrl+Alt+T | Open or close every toggle |
| Ctrl+/ | Block menu |
| Ctrl+D | Duplicate the selected blocks |
| Ctrl+Shift+↑ / ↓ | Move the selected blocks |
| Tab · Shift+Tab | Indent · outdent |
| Esc · Enter | Select the block · edit the selected block |
| Ctrl+A | Select the block's text, then all blocks |
| Ctrl+Z · Ctrl+Shift+Z | Undo · redo |
| Ctrl+Shift+V | Paste as plain text |
| Ctrl+Shift+U | Go to the parent page |

- Every drag has a keyboard way (Ctrl+Shift+↑ / ↓, Move to) and a menu way.
- Screen readers: the editor is a labelled text area; block types are announced when entering a block ("Heading 2", "To-do, not done"); tick boxes, toggles and tabs are real controls with their state; moves are announced ("Moved below 'Refund steps'").

**Phone**

- A toolbar above the keyboard: + (add a block), Aa (turn into and formatting), @, comment, picture, indent, outdent, undo, redo, and hide keyboard.
- Long-press a block to select it and open its menu as a bottom sheet; then drag its handle to move it.
- The "/" menu shows above the keyboard. Pictures open full screen. Tables scroll sideways inside their block. Columns stack. Embeds fit the width.

## Done means

Try these in the browser with fictional data. ⭐ marks what the team will notice first. Each check uses its acceptance-check ID from section 7, so tests, results and Friday's list use the same IDs.

1. ⭐ **PB-01** On a new page, type / and pick To-do, then type ## and a space on the next line. → A to-do and a heading appear; Ctrl+Z right after the ## turns it back into the typed text.
2. ⭐ **PB-30** Avery Lin and Sam Ortiz open "Weekly huddle – Oct 27" in two browsers and type in the same paragraph. → No letters are lost, each sees the other's named cursor, and Ctrl+Z undoes only your own typing.
3. ⭐ **PB-25** Copy a section with headings, a list, a table and a link from a Google Docs file and paste it. → It keeps its structure; Ctrl+Shift+V pastes the same text plain.
4. ⭐ **PB-06** Drag 3 photos from the computer onto a page. → 3 image blocks appear in the same order.
5. ⭐ **PB-19** Rename "Refund steps" to "Refund steps 2026". → Its mentions, links, breadcrumbs and sidebar entry change at once.
6. **PB-03** Press Tab on a bullet below another bullet, then Shift+Tab. → It nests, then un-nests.
7. **PB-02** Turn a bullet that has children into a heading, then into a to-do. → The text, formatting and children stay.
8. **PB-05** Drag a block to the right edge of another block. → Two columns; at phone width they stack.
9. **PB-26** Paste a Care Hub page link, then a web link. → The first becomes a page mention; the second offers Mention, Bookmark and Embed.
10. **PB-28** Type @tomorrow 9am and add a reminder 15 minutes before. → A date chip appears, and the reminder arrives in the 🔔 chat on time.
11. **PB-31** Turn the network off for 2 minutes while typing, then on. → Typing never stops, and everything saves once, in order.
12. **PB-36** On a phone, use the / menu, long-press a block and open a picture. → The menus work and the picture opens full screen.

## 7. Acceptance checks

- **PB-01** Every block in the catalog can be added from "/", and each Markdown shortcut makes its block; Ctrl+Z right after turns it back into the typed text.
- **PB-02** Turn into between all text-like blocks keeps text, formatting and children; Turn into Page moves the children into the new page.
- **PB-03** Tab and Shift+Tab nest and un-nest up to level 20 (a top-level block is level 1, so 19 Tabs at most), only under blocks that can hold children; at level 20, Tab does nothing.
- **PB-04** Selecting several blocks with Shift+↓, the margin box and Shift-click, then duplicating, coloring, moving and deleting them, works as one action and undoes as one.
- **PB-05** Dragging a block to another block's right edge makes 2 columns, up to 5; a 3-column layout stacks on a 390 px wide phone.
- **PB-06** Dropping 3 pictures from the computer makes 3 image blocks in order; the location data is gone from the stored files.
- **PB-07** An image can be resized, aligned, captioned and described; the description is read by a screen reader; the viewer opens, zooms and moves to the next picture.
- **PB-08** Video, audio, file and PDF blocks upload and play or show; a 310 MB file is refused with the limit in the message.
- **PB-09** A YouTube link pasted and turned into an embed plays; a link from a site that isn't approved offers only Bookmark or Link; a hand-made save with an unapproved embed is cleaned by the server.
- **PB-10** A bookmark shows title, description and picture; previews never come from local or Tailscale addresses (tested with a link to the ThinkCentre's own address).
- **PB-11** Code: language colors, wrap, line numbers and Copy work; Tab indents inside; a Mermaid diagram previews and a broken one shows its error.
- **PB-12** Block and inline equations draw; a broken one shows "Invalid equation" and keeps the text.
- **PB-13** Simple table: header row and column, add, drag, resize, color cells, paste a 4 × 6 block from a spreadsheet, and Turn into database.
- **PB-14** Toggles and toggle headings open and close; the state is per person (another person's view doesn't change); Ctrl+Alt+T does all.
- **PB-15** Tabs: add, rename, icon, reorder, delete with warning; the open tab is remembered per person; a block link inside tab 3 opens tab 3.
- **PB-16** Table of contents lists headings with indents, jumps on click, and updates live; the floating one appears only when turned on and the screen is wide enough.
- **PB-17** Synced block: an edit in the copy shows in the original within 1 second; someone without access to the original's page sees the no-access message; Unsync and Unsync all work; deleting the original leaves read-only copies with the message.
- **PB-18** Copy link to block opens the page scrolled to the block, highlighted, with toggles and tabs around it open.
- **PB-19** Renaming a page updates its mentions, links, breadcrumbs and sidebar entry live; a link to a trashed page shows struck through and returns on restore.
- **PB-20** Backlinks list only pages the viewer can open; the three Customize page settings work.
- **PB-21** Font, Small text, Full width and right-to-left text direction change the page for everyone and survive a reload.
- **PB-22** A locked page refuses edits from everyone, including by direct request (403), until unlocked; comments still work.
- **PB-23** Duplicate copies sub-pages, databases with rows, and files, and links inside point to the copies; comments and history aren't copied.
- **PB-24** Move to warns when access changes, and the moved page keeps its sub-pages.
- **PB-25** Pasting from a Google Docs file and a web page keeps headings, lists, tables, links and basic formatting; pasting Markdown text makes blocks; Ctrl+Shift+V pastes plain text.
- **PB-26** Pasting a web link offers Mention, Bookmark and Embed; pasting a Care Hub link makes a page mention.
- **PB-27** Copying blocks into a plain text editor gives Markdown.
- **PB-28** "@tomorrow 9am" makes a date chip; adding "15 minutes before" sends the reminder through Home and reminders on time; viewers in Denver and London see their own times.
- **PB-29** Colors look right and keep 4.5:1 contrast in light and dark mode for all 20 colors.
- **PB-30** Two people typing in the same paragraph never lose characters; cursors show names; Ctrl+Z only undoes your own typing.
- **PB-31** With the network cut for 2 minutes, typing goes on; on reconnecting everything arrives once, in order; closing the tab with unsent changes asks first.
- **PB-32** Someone with Can view gets a read-only connection, and a change sent by a hand-made client is refused (403) and the connection closed.
- **PB-33** A file link from a page is refused (403) for someone who can't open that page.
- **PB-34** A 2,000-block page opens in about a second on the ThinkCentre, and typing shows each key within 50 ms; the 20,000-block limit shows its message.
- **PB-35** Every shortcut in section 6 works on Windows and Mac; every drag has a keyboard and a menu way; axe finds no serious problems.
- **PB-36** Phone: the keyboard toolbar, long-press menu and drag, the "/" menu, and full-screen pictures work.
- **PB-37** A new page opens untitled (the title shows "Untitled" until you type), with the cursor in the title.
- **PB-38** Add icon with an emoji: it shows on the page, in the sidebar and in the browser tab, and stays after a reload.
- **PB-39** Add cover puts a gallery cover on the page; Change swaps it for an uploaded picture; Remove takes it off. Each change stays after a reload.
- **PB-40** Links in text: Ctrl+K on selected text adds a link to a web address or a searched Care Hub page; hovering the link offers Edit and Remove, and both work. Clicking a Care Hub link opens it in the same tab; a web link opens in a new tab.

## Decisions for Felipe

- 🟨 **PB-D1** Notion offers cover pictures from Unsplash (an outside service that needs a key). **Default:** no; use Care Hub's own cover gallery and uploads.
- 🟨 **PB-D2** Live link previews that keep updating from other services (GitHub, Jira, Figma, Slack). They need a sign-in to each service. **Default:** later.
- 🟨 **PB-D3** When someone pastes web content or adds a picture by its web address, should Care Hub download and keep the picture? **Default:** yes, up to 10 MB each, from public addresses only; anything else becomes a link.
- 🟨 **PB-D4** The starter list of approved embed sites in section 3.10. **Default:** that list; Admins can change it later.
