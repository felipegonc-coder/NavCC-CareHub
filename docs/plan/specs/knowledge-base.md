# Knowledge base

_Copied from the Notion spec (https://app.notion.com/p/5881ceb25bee45c9b656d8d51deda4ac) on 2026-10-27. If they differ, Notion wins._

> 📚 Phase 3 · Notion parity plus Care Hub extras · Depends on: Databases (wiki databases, the Verification property), Pages and blocks, Roles and permissions, Messages (🔔 notices) · Related: Search (✓ badge and ranking), Page history and Trash (archive), Templates and buttons (the Team wiki starter)

## 1. What it's for

Turning a page into a team knowledge base, like Notion's wikis, so people can trust what they read. Each page in it has an owner, a "verified until" date, Draft or Published status and tags. Readers only see published pages and can report problems to the owner; owners get reminders when pages are due for review.

## 2. Screens and states

- **Turn into knowledge base** (page menu or sidebar menu): "Turn Support handbook into a knowledge base? Its 24 sub-pages become knowledge base pages with an owner, status and verification. You can turn it back later." Turn into knowledge base or Cancel.
- **Knowledge base home:** title, icon and description; the original page content as a Home section above the views (editors can edit it); a health line for editors ("86% verified · 4 expired · 2 open reports"); views: Published (a list grouped by tag), All pages (a table: Name, Owner, Status, Verification, Tags, Last edited), Needs review (expired, expiring within 14 days, or without an owner), Drafts and Reports (both for editors and owners only), and My pages (Owner is me). The database toolbar (search, filters) works as usual.
- **A knowledge base page:** under the title, a strip with the verification badge, the owners, the status and the tags. Badges: green "✓ Verified by Riley Chen until Jan 20, 2027", orange "Verification expired Oct 1", or grey "Not verified". Report a problem sits at the bottom of the page and in the page menu.
- **Verify menu** (owners and people with Full access): Verify for 1 week, 30 days, 90 days (the default), 6 months, 1 year, until a date, or with no end date; Remove verification.
- **Banners:** Draft, in blue: "Draft. Only editors can see this page. · Publish". For readers of an expired page: "Verification expired on Oct 1. This page may be out of date." For owners and editors of an expired page: "Due for review since Oct 1 · Review now".
- **Review bar** (from Review now or a notice): "Still correct? · Verify for 90 days · Needs changes · Archive".
- **Report a problem:** "What's wrong?" (Out of date, Wrong or unclear, Broken link or file, Something's missing, Other), a text box (required for Other; up to 2,000 characters), and, if text was selected, the quote ("About: within 3 days"). Send. Then: "Thanks. Riley Chen will take a look." The dialog also lists "Your reports" on this page with their status.
- **Reports view:** each report with page, reason, text, quote, reporter, when and status (New, In progress, Fixed, Won't fix); opening one shows its replies and a reply box.

| State | What shows |
| --- | --- |
| Empty knowledge base | "No pages yet." with + New page |
| No reports | "No open reports." |
| Page without an owner | Grey "No owner" chip, and "Pick an owner" for editors |
| Owner without access | "Riley Chen can't open this page anymore." with Pick an owner |
| A draft opened by a reader | Shown as a page they can't open (Roles and permissions) |

## 3. Behavior and edge cases

### 3.1 Making and undoing a knowledge base

- Turning a page into a knowledge base makes it a wiki database (Databases) at the same address (/p/ and the page ID). Its content becomes the Home section, and each direct sub-page becomes a knowledge base page with Owner as its creator, Status Published, Verification Not verified and no tags. Deeper sub-pages stay under their pages and follow their Draft or Published state.
- Links, access, comments and history are kept. Inline databases and other blocks stay in Home.
- The four built-in properties (Owner, Status, Verification, Tags) can't be deleted while it's a knowledge base; any other property can be added (Databases, Formulas).
- **Turn back into a page** (database menu): pages become sub-pages again. The confirm says what goes: "Owner, status, verification, tags and 3 open reports will be removed." Drafts become normal sub-pages that only editors can open, so nothing is shown to readers by surprise.
- **Settings** (Full access on the knowledge base): default verification period (90 days), and "Editing removes verification" (off; when on, any edit to a verified page makes it Not verified and tells its owners).
- Up to 5,000 pages per knowledge base. The Team wiki starter template (Templates and buttons) is an empty knowledge base.

### 3.2 Owners, drafts and publishing

- New pages start as Draft, with their creator as owner. Up to 5 owners per page; an owner must be able to edit the page, and picking someone who can't asks to share it first (as with mentions in Comments and mentions).
- **Drafts** are seen only by their owners and by people with Can edit or Full access on the knowledge base. For everyone else a draft is a page they can't open: it's left out of views, counts, search, links, mentions, backlinks, Home and notices, checked on the server, as in Roles and permissions.
- **Publish** (owners or editors) shows the page to readers at once. **Back to draft** asks first: "Readers won't see this page anymore."
- Edits to a published page are live, as in Notion; a separate draft copy of a published page is 🟨 KB-D1.
- **When an owner leaves** the workspace or loses access, the people with Full access on the knowledge base get a 🔔 notice: "Riley Chen no longer owns 12 pages in Support handbook. Pick new owners." The pages show "No owner" and appear in Needs review.

### 3.3 Verification and reviews

- Verifying sets who verified it, when, and until when. The badge shows in the page strip, in views, in search (where verified pages also rank higher; Search) and in the Verification property's filters (Databases).
- On the "until" date, at 9:00 AM in the owner's time zone, the page becomes Expired: the badge turns orange and readers see the expired banner.
- **Review notices** (🔔, in the Reminders filter): a weekly summary on Monday at 9:00 AM in each owner's time zone for pages expiring in the next 14 days or already expired ("3 pages in Support handbook need review"), and one notice on the day a page expires. Archived pages get none (Page history and Trash).
- **Review now** opens the page with the review bar. Verify for 90 days renews it (or the knowledge base's default period). Needs changes keeps it Expired and starts editing. Archive archives it.
- Verification with no end date never expires.

### 3.4 Report a problem

- Anyone signed in who can open a published page can report a problem; share-link visitors can't.
- A report goes to the page's Reports view, and its owners get a 🔔 notice; a page without an owner sends it to the people with Full access on the knowledge base.
- Reporting the same page again within 7 days asks "You reported this page yesterday. Add to that report?"
- Owners and editors set the status and reply; the reporter gets a 🔔 notice for each reply and when the report is marked Fixed or Won't fix. Replies work like comments (text, mentions, files).
- Reports are private: only the reporter, the page's owners and the knowledge base's editors can see them. Other readers never see that a page was reported.
- Owners see the number of open reports on the page strip ("2 open reports"). Closed reports stay for as long as the page exists.

## 4. Data it stores

- **Knowledge base:** its database (of the wiki kind), Home content, default verification period, editing removes verification (on or off).
- **Built-in properties** for each page: Owner (people), Status (Draft or Published, with who published and when), Verification (state, verified by, verified on, verified until or no end), Tags.
- **Report:** page, reporter, reason, text, quote and block, status, replies (author, text, files, when), created, closed by and when.
- **Review notices:** each owner's last summary, and which pages it listed.

## 5. Permissions

| Action | Needs |
| --- | --- |
| Turn a page into a knowledge base, or back | Full access on the page, and the Create permission |
| Read published pages | Can view |
| Read drafts | Being an owner, or Can edit on the knowledge base |
| Add pages | Can edit content on the knowledge base |
| Publish or move back to draft | Being an owner, or Can edit on the knowledge base |
| Verify or remove verification | Being an owner, or Full access on the knowledge base |
| Change owners and tags | Can edit on the knowledge base (owners can change tags) |
| Report a problem | Can view on the published page, signed in |
| Read, answer and close reports | Being an owner, or Can edit on the knowledge base (reporters see their own) |
| Knowledge base settings | Full access on the knowledge base |

- Direct requests for drafts or for other people's reports without this access are refused (403), and the responses have no titles.

## 6. Keyboard and phone

- The verify menu, the review bar, the report dialog and the Reports view all work by keyboard; Esc closes dialogs and returns focus.
- Badges and statuses always have words as well as colors. Screen readers hear "Verified by Riley Chen until January 20, 2027" and "Draft".
- **Phone:** the strip wraps under the title; Report a problem is at the page bottom; the review bar sticks to the bottom of the screen; Reports is a list that opens each report full screen.

## Done means

Try these in the browser with fictional data. ⭐ marks what the team will notice first. Each check uses its acceptance-check ID from section 7, so tests, results and Friday's list use the same IDs.

1. ⭐ **KB-01** Turn Support handbook (24 sub-pages) into a knowledge base. → 24 pages with Owner, Published and Not verified; their addresses, links, comments and history stay.
2. ⭐ **KB-03** Add a new page, then open the knowledge base as Riley, a reader. → The page starts as Draft, and Riley can't see it anywhere, including search.
3. ⭐ **KB-04** Publish it, then choose Back to draft. → Riley sees it at once, and after the confirm it's hidden again.
4. ⭐ **KB-05** Verify Refund policy for 90 days; then, with test data, let its until date arrive. → The badge shows your name and the date; at 9:00 AM in the owner's time zone it turns Expired, and readers see the banner.
5. **KB-07** On an expired page choose Review now → Verify, and on another Review now → Needs changes. → The first gets a new date; the second stays Expired and opens for editing.
6. **KB-08** As Riley, use Report a problem on Refund policy ("The phone number is wrong"), then reply and close it as the owner. → It shows in Reports and in the owner's 🔔 chat, and Riley is told about the reply and the closing.
7. **KB-11** Turn on Editing removes verification, then edit a verified page. → It becomes Not verified, and its owners are notified.
8. **KB-12** Search for a word that's on a verified page and on an unverified one. → The verified page comes first.
9. **KB-02** Turn the knowledge base back into a page. → The confirm lists what goes, the pages become sub-pages again, and drafts stay hidden from readers.

## 7. Acceptance checks

- **KB-01** Turning a page with 24 sub-pages into a knowledge base gives 24 pages with Owner, Published and Not verified, and keeps the address, links, comments and history.
- **KB-02** Turning it back makes sub-pages again after a confirm listing what goes; drafts stay hidden from readers.
- **KB-03** New pages start as Draft; a reader doesn't see a draft in views, counts, search, links, mentions, backlinks or notices; direct requests are refused (403).
- **KB-04** Publish shows the page to readers at once; Back to draft hides it again after the confirm.
- **KB-05** Verify for 90 days shows the badge with the name and date; on the until date the page turns Expired at 9:00 AM in the owner's time zone and readers see the banner.
- **KB-06** Owners get the Monday summary for pages expiring within 14 days and a notice on the day; archived pages get none.
- **KB-07** Review now → Verify renews the date; Needs changes keeps it Expired and starts editing.
- **KB-08** A report reaches the Reports view and the owners' 🔔 chat; replies and closing notify the reporter.
- **KB-09** Only the reporter, owners and editors see a report; anyone else's direct request is refused (403).
- **KB-10** When an owner is removed from the workspace, Full access people get the notice, and the pages show No owner and appear in Needs review.
- **KB-11** With "Editing removes verification" on, an edit makes the page Not verified and notifies its owners.
- **KB-12** A verified page ranks above an otherwise equal unverified page in search (SR-05); the health line's numbers match the views.
- **KB-13** Everything works by keyboard and screen reader; axe finds no serious problems; the phone layout works.

## Decisions for Felipe

- 🟨 **KB-D1** A separate draft copy for published pages: owners edit privately and publish all the changes at once, while readers keep seeing the published version. Notion edits published pages live. **Default:** later; edits are live for now.
