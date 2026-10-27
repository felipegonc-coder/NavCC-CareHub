# Search

_Copied from the Notion spec (https://app.notion.com/p/be06de5ee77c4f2ea8a814621e32cfb5) on 2026-10-27. If they differ, Notion wins._

> 🔎 Phase 1 · Notion parity · Depends on: Pages and blocks, Roles and permissions, Sidebar, spaces and nested pages · Used by: Messages ("Search messages for…"), Knowledge base, Analytics (search terms), every page picker · Related: Databases (toolbar search), Page history and Trash (search in Trash), Data settings (index size)

## 1. What it's for

Finding any page, database or row the person can open, quickly and from anywhere: a search window with recent pages, filters, sorting and highlighted matches, plus find and replace inside a page. Messages has its own message search (Messages spec), and each database has its toolbar search (Databases spec).

## 2. Screens and states

- **Search window:** opens from Search in the sidebar, Ctrl+K or Ctrl+P. (In the editor with text selected, Ctrl+K is still Link, as in Pages and blocks.) A centered window, 640 px wide: a search box, filter chips under it and results below. It searches the current workspace only.
- **Before typing:** Recent, the last 8 pages the person opened (the Sidebar's recent list), and Recent searches, the last 5, each with ✕, plus Clear.
- **Actions:** typing "remind" while a page is open shows "Remind me about this page" first (Home and reminders).
- **Result rows:** icon; title with the matching words in bold; the path ("Support › Policies › Refunds"); up to 2 lines from the best-matching block with the matching words highlighted; "Edited Oct 20 by Sam Ortiz"; and badges where they apply: Database, "Row in Tickets", ✓ Verified (Knowledge base), Archived. The first result is selected. More results load 20 at a time as you scroll.
- **Filter chips:** Title only (on or off) · Created by (people) · Edited by (people) · In (spaces or pages, including their sub-pages) · Date (Edited or Created: Today, Last 7 days, Last 30 days, or a range) · Type (Pages, Databases, Rows, Files) · Include archived (on or off). **Sort:** Best match (default), Edited newest or oldest first, Created newest or oldest first. "Clear filters" appears once any filter is on.
- **Footer:** "Search messages for ‘refund’", which opens Messages search with the same text (members only; guests don't have Messages, RP-D2), and hints: ↑↓ move · Enter open · Ctrl+Enter new tab · Shift+Enter side panel.
- **Find in page** (Ctrl+F on a page): a small bar at the top right with a search box, "3 of 12", ↑ and ↓, Match case, and for editors Replace (Ctrl+H) with Replace and Replace all.

| State | What shows |
| --- | --- |
| Searching | The previous results stay; grey placeholder rows after 150 ms if there were none |
| No results | "No results for ‘refnd’." Then "Did you mean refund?" when a title is close, Clear filters when filters are on, and Search in Trash |
| Offline | "You're offline. Showing recent pages." with the recent list only |
| Error | "Search isn't working right now." with Try again |
| Index rebuilding | "Search is being rebuilt (42%). Only titles are searched for now." |

## 3. Behavior and edge cases

### 3.1 What's searched

- **Pages:** title and the text of every block, including closed toggles, table cells, callouts, code, equations (as their source text) and captions. Mentions count as their current text ("@Avery Lin", a page's current title). Synced block content counts on every page where it shows.
- **Databases:** title and description. **Rows:** title and the same property values as the Databases toolbar search (text, links, emails, phones, option names, people's names, Unique IDs like QA-17), plus the row page's text.
- **Files:** file names and captions, and 🟨 SR-D1 the text inside PDF, Word, Excel and PowerPoint files, read in the background after upload (up to 1 million characters per file; pictures and scanned pages aren't read). A match shows the page that holds the file with "In refund-policy.pdf, page 3".
- **Not searched here:** comments, messages (Messages has its own search), page versions, Trash (the Trash screen has its own search), database templates, and the template gallery.
- Every page picker (the link editor, Move to, the @ menu, relation pickers, Share page in Messages) uses the same search, titles only.

### 3.2 Matching and ranking

- Case and accents don't matter ("goncalves" finds "Gonçalves"), and English word forms match ("refunds" finds "refund"). While typing, the last word also matches as a beginning ("ref" finds "Refund steps"). This uses Postgres full-text search, as Messages does.
- All words must match, unless the person uses OR. "Quotes" match an exact phrase, and a minus excludes a word (-draft). A hyphen inside a word, as in QA-17, isn't an exclude.
- **Did you mean:** when there are fewer than 3 results, Care Hub looks for a title one or two letters off and offers it.
- **Best match** puts title matches first (exact title, then title starting with the words, then all words in the title), then headings, then text. Within that, pages the person opened in the last 30 days, recently edited pages and ✓ Verified knowledge base pages rank higher, and archived pages (when included) rank lower. Ties go to the most recently edited.
- **Snippets** come from the block with the most matching words, up to 160 characters around the first match.

### 3.3 Access and freshness

- Results only include what the person can open at that moment. The server checks access before counting, ranking and making snippets, with row access (Databases, DB-D2) and hidden properties included: a hidden property is never matched or shown. Guests only find what's shared with them.
- Access isn't copied into the index; it's checked on every search, so losing access removes results at once.
- New pages and renames are found within 2 seconds, and content edits within 5 seconds. A page moved to Trash disappears at once, comes back on restore, and leaves the index when deleted forever.
- Archived pages and pages in archived spaces are left out unless Include archived is on.
- Share-link visitors can't search.

### 3.4 Recent searches and search terms

- A search is saved to Recent searches when the person opens a result or presses Enter. Each person has their own list per workspace; Clear empties it.
- For the Analytics search tab, Care Hub counts search terms per day without saving who searched: the term, how many searches, how many people (a number only), how many found nothing, and how many led to an opened result. A term only shows in Analytics once at least 2 different people have searched it in the chosen period. These counts are kept as long as Analytics activity (Data settings).

### 3.5 Find and replace in a page

- Care Hub's own Find in page is needed because long pages load in parts. Pressing Ctrl+F again while the bar is focused opens the browser's own find.
- It finds text in the title and in every block, including table cells and closed toggles (which open when a match inside is selected). All matches are highlighted and the current one more strongly. Inline databases aren't included; their toolbar search is.
- Matches update live as others edit (co-editing).
- **Replace** (Can edit; locked pages must be unlocked first): Replace changes the current match and moves to the next; Replace all changes every match and shows "Replaced 12" with Undo, as one undo step. Mentions, equations and button labels aren't changed. A match inside a synced block warns first: "This also changes 2 other pages." In Suggesting mode (Comments and mentions), replacements become suggestions, so people with Can comment can use Replace that way.
- On a full-page database, Ctrl+F goes to the toolbar search instead.

### 3.6 Rebuilding the index

- Site admins can rebuild the search index under Settings → Data → Storage ("Rebuild search index"), for example after restoring a backup. While it rebuilds, titles are still searched and the state shows in the search window. Its size shows under Storage (Data settings).

## 4. Data it stores

- **Index entry**, one per page, database and row: page, workspace, space, path, title text, text per block (block ID, text), property text, file text, created (by whom, when), edited (by whom, when), archived, in Trash, ✓ verified until (Knowledge base). Updated after each save.
- **File text:** file, part (page or sheet), text, and a status (waiting, done, no text found, too big, failed).
- **Recent searches:** person, workspace, text, filters, when; the last 5 are kept.
- **Search terms:** workspace, day, term (lowercase, up to 100 characters), searches, people (count only), no results, opened.
- Search requests take the text, filters, sort and a cursor, and return 20 results at a time.

## 5. Permissions

| Action | Needs |
| --- | --- |
| Find and open a result | Can view on that page, including row access rules |
| See a property value in a snippet | The property isn't hidden from them |
| Replace in a page | Can edit (with Can comment, Replace makes suggestions) |
| Search messages | Being a member (not a guest) |
| See search terms | Admin settings permission (Analytics is for Admins only, AN-D1) |
| Rebuild the search index | Site admin |

- A direct request for another person's recent searches, or a search with a crafted filter for a space or page the person can't open, returns nothing from it.

## 6. Keyboard and phone

- Ctrl+K or Ctrl+P opens search from anywhere. Typing starts at once; ↑ and ↓ move; Enter opens; Ctrl+Enter opens in a new tab; Shift+Enter opens in the side panel; Tab reaches the filters and sort; Esc closes and puts focus back where it was.
- Screen readers hear the number of results ("12 results") and each result as "Refund steps, page in Support › Policies, edited Oct 20".
- Find in page: Ctrl+F opens it, Enter goes to the next match and Shift+Enter to the previous one, Ctrl+H opens Replace, and Esc closes it with the cursor at the current match.
- **Phone:** Search in the bottom bar opens a full-screen search with the filter chips in a row that scrolls sideways. Find in page is in the page menu.

## 7. Acceptance checks

- **SR-01** Ctrl+K and Ctrl+P open search on every screen; with text selected in the editor, Ctrl+K opens the link editor instead.
- **SR-02** Before typing, the last 8 opened pages and the last 5 searches show; Clear empties the recent searches.
- **SR-03** "ref" finds "Refund steps" while typing, "refunds" finds "refund", "goncalves" finds "Gonçalves", and case doesn't matter.
- **SR-04** Quotes, minus and OR work as described; searching QA-17 finds that row.
- **SR-05** A title match ranks above a text match, a ✓ Verified page ranks above an otherwise equal page, and ties are most recently edited first.
- **SR-06** Each filter and sort works on its own and combined with the others.
- **SR-07** Snippets highlight the matching words and never contain text from a hidden property or from a page the person can't open.
- **SR-08** With 1,000 pages of which Avery can open 40, every result, count and snippet comes from those 40, row access included; direct requests can't widen it.
- **SR-09** A renamed page is found by its new name within 2 seconds and an edit within 5 seconds; a page moved to Trash disappears at once; removing someone's access removes it from their results at once.
- **SR-10** Text inside a PDF, a Word file and an Excel file is found with the file name and page in the snippet (SR-D1); a scanned PDF shows "No text found" in its file details.
- **SR-11** No results shows Did you mean (for a close title), Clear filters and Search in Trash.
- **SR-12** "Search messages for…" opens Messages search with the same text; guests don't see it.
- **SR-13** With 50,000 pages and 5,000 files, 95% of searches answer within 500 ms on the ThinkCentre.
- **SR-14** Find in page finds matches in closed toggles and table cells and moves between them; Replace all changes 12 matches in one undo step; a viewer has no Replace.
- **SR-15** Search terms in Analytics never show who searched, and a term searched by only one person isn't listed.
- **SR-16** Everything works by keyboard and screen reader; axe finds no serious problems; the phone layout works.

## Decisions for Felipe

- 🟨 **SR-D1** Search the text inside uploaded PDF, Word, Excel and PowerPoint files. It means background work after uploads and an index about a tenth of the files' size. **Default:** yes.
