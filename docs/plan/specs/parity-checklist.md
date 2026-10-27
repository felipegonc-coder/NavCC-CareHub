# Notion parity checklist

_Copied from the Notion spec (https://app.notion.com/p/cb343e6d8b204ee28047788d6cc9dd14) on 2026-10-27. If they differ, Notion wins._

> ✅ Notion parity checklist · Oct 27 · Each row maps a Notion feature to where Care Hub covers it. ✅ covered · 🟨 open decision, with the suggested default · ⏳ planned for a later phase · ➖ different on purpose, with the reason

## How to read this

- Felipe's goal is Notion parity plus Care Hub's own extras (Messages, Learning, private transcription, knowledge-base reviews). This page is the check that nothing was missed; the specs themselves are the source of truth.
- Section numbers point into each spec. "🆕" in a spec marks what the parity pass added on Oct 27.
- Everything stays inside the builder rules: no email, no outside services unless Felipe decides otherwise, everything on the ThinkCentre and the tailnet.

## Pages and the editor

| Notion | Care Hub | Status |
| --- | --- | --- |
| Pages with icon, cover, fonts, small text and full width | Pages and blocks 3.1–3.2 | ✅ |
| Cover pictures from Unsplash | Pages and blocks 3.1 (Care Hub's own covers and uploads) | 🟨 PB-D1: no |
| Text, headings, lists, to-dos, toggles, toggle headings, quotes, callouts, dividers, columns | Pages and blocks 3.4 | ✅ |
| Simple tables, tabs, table of contents, breadcrumbs, equations, code with Mermaid diagrams | Pages and blocks 3.4 | ✅ |
| Pictures, video, audio, files and PDFs | Pages and blocks 3.4, 3.11; limits in Data settings 3.3 | ✅ |
| "/" menu, Markdown shortcuts, block menu, drag and drop, selecting many blocks | Pages and blocks 3.3, 3.6 | ✅ |
| Text formatting, colors, links, inline code and equations | Pages and blocks 3.5 | ✅ |
| Page mentions, link to page, backlinks | Pages and blocks 3.1, 3.4 | ✅ |
| Date mentions with reminders | Pages and blocks 3.7; Home and reminders | ✅ |
| Synced blocks | Pages and blocks 3.9 | ✅ |
| Embeds and web bookmarks | Pages and blocks 3.10 | 🟨 PB-D4: the starter list of approved sites |
| Live link previews (GitHub, Jira, Figma, Slack) | Pages and blocks 3.10 | 🟨 PB-D2: later |
| Pasting from other apps, copying as Markdown | Pages and blocks 3.8 | 🟨 PB-D3: keep pasted web pictures (up to 10 MB) |
| Live co-editing, who is on the page, and typing through connection drops | Pages and blocks 2, 3.12 | ✅ |
| Lock page, Duplicate, Move to, Copy link | Pages and blocks 3.2 | ✅ |
| Move a page to another workspace | Pages and blocks 3.2 🆕; switch in Settings and members 3.5 | ✅ |
| Find and replace in a page | Search 3.5 | ✅ |
| Undo and redo | Pages and blocks 3.3 | ✅ |
| Pages available offline (Notion's apps) | Typing goes on through drops (Pages and blocks 3.12) | 🟨 PC-D1: later |

## Sidebar and getting around

| Notion | Care Hub | Status |
| --- | --- | --- |
| Sidebar with Private, Shared, Favorites and Recent | Sidebar, spaces and nested pages 2, 3.1, 3.4 | ✅ |
| Teamspaces (open, closed, private), owners, archive | Sidebar, spaces and nested pages 3.3 ("spaces") | ✅ |
| Nested pages and dragging in the tree | Sidebar, spaces and nested pages 3.2 | ✅ |
| Several workspaces and the switcher | Sidebar, spaces and nested pages 3.5; Settings and members 3.4, 3.6 | ✅ |
| Open in side peek or a new tab | Sidebar, spaces and nested pages 3.2 ("side panel") | ✅ |
| Keyboard shortcut list and Help | Settings and members 3.2; Sidebar, spaces and nested pages 2 | ✅ |

## Search

| Notion | Care Hub | Status |
| --- | --- | --- |
| Search window (Ctrl+K, Ctrl+P) with recent pages | Search 2 | ✅ |
| Filters (title only, created by, edited by, teamspace, page, date) and sorts | Search 2, 3.2 | ✅ |
| Results only from what you can open | Search 3.3 | ✅ |
| Verified pages ranked higher | Search 3.2; Knowledge base 3.3 | ✅ |
| Text inside uploaded PDFs and Office files | Search 3.1 | 🟨 SR-D1: yes |
| Search in a database view | Databases 3.2 | ✅ |
| Search analytics | Analytics 2 🆕 | ✅ |
| AI answers from the workspace | Claude features | ⏳ Phase 5 |
| Searching connected apps (Slack, Google Drive) | — | ➖ no outside connections |

## Comments, mentions and notifications

| Notion | Care Hub | Status |
| --- | --- | --- |
| Page, text, block and property comments; resolve; reactions | Comments and mentions 3.1 | ✅ |
| Suggested edits | Comments and mentions 3.2 | ✅ |
| @mentions of people, pages and dates | Comments and mentions 3.3 | ✅ (plus groups) |
| Inbox and following pages | Comments and mentions 3.4; the 🔔 chat in Messages | ✅ |
| Notification settings and pausing | Settings and members 3.3 | ✅ |
| Push notifications on computers and phones | Messages (MS-D2) | ✅ |
| Email notifications and digests | — | ➖ no email (builder rules) |
| Slack notifications | — | ➖ no outside apps |

## Sharing and permissions

| Notion | Care Hub | Status |
| --- | --- | --- |
| Full access, Can edit, Can edit content, Can comment, Can view | Roles and permissions | ✅ |
| Share dialog, inherited access, removing inherited access | Roles and permissions (Sharing) | ✅ ("Stop inheriting") |
| Guests | Roles and permissions (Guests) | ✅; 🟨 RP-D2: no Messages for guests |
| Groups | Roles and permissions (Groups); Settings and members 3.4 | ✅ |
| Access requests | Roles and permissions (Access requests) | ✅ |
| Database page-level permissions | Databases 3.12 (row and property access) | ✅ |
| Workspace roles | Roles and permissions (Admin, Editor, Commenter, Viewer and custom roles) | ✅ |
| Publish to the web and Notion Sites | Roles and permissions (Share links) | 🟨 RP-D3: yes, tailnet only; ➖ no custom domains or search engines |

## History, Trash and archive

| Notion | Care Hub | Status |
| --- | --- | --- |
| Page history with preview and restore | Page history and Trash 3.1–3.2 | ✅ (plus named versions) |
| Updates and page activity | Page history and Trash 3.3 | ✅ |
| Trash with restore and delete forever | Page history and Trash 3.4 | ✅ |
| How long versions and Trash are kept | Data settings 3.1 | 🟨 DS-D2: versions 1 year, Trash 30 days |
| Archive pages | Page history and Trash 3.5 | ✅ (Care Hub extra) |

## Templates and buttons

| Notion | Care Hub | Status |
| --- | --- | --- |
| Template gallery | Templates and buttons 3.1 | 🟨 TB-D1: Care Hub's own starter list |
| Workspace templates (save as template) | Templates and buttons 3.1 | ✅ |
| Database templates, default per view, repeating templates | Templates and buttons 3.2 | ✅ |
| Template variables and "This page" filters | Templates and buttons 3.3 | ✅ |
| Buttons in pages and as a database property | Templates and buttons 3.4; Databases 3.4 | ✅ |
| Template marketplace | — | ➖ not planned |

## Import and export

| Notion | Care Hub | Status |
| --- | --- | --- |
| Import Markdown, text, HTML, Word, Google Docs, CSV and Excel | Import and export 3.2; Databases 3.7 | ✅ |
| Import from Notion, Evernote, Confluence, Trello and Asana | Import and export 3.2 (from their export files) | ✅ |
| Importers that sign in to other services (Jira, Monday, Google Drive) | Import and export | 🟨 IE-D1: no |
| Export Markdown and CSV, HTML or PDF, and print | Import and export 3.3 | ✅ |
| Export the whole workspace | Data settings 3.5–3.6 | 🟨 DS-D1: not other people's private content |
| Turning off export | Settings and members 3.5; Import and export 3.3 | ✅ |

## Databases, formulas and forms

| Notion | Care Hub | Status |
| --- | --- | --- |
| Table, board, list, gallery, calendar, timeline, chart, feed, dashboard and form views | Databases 3.2–3.3; Forms | ✅ |
| Map view and the Place property | Databases 3.4 | 🟨 DB-D5: later |
| Several data sources in one database | Databases | 🟨 DB-D6: later |
| All property types, including relations, rollups, formulas, unique IDs, buttons and status | Databases 3.4, 3.9–3.10 | ✅ |
| Formulas 2.0 | Formulas | ✅ |
| Filters, sorts, groups, sub-groups and calculations | Databases 3.2–3.3, 3.11 | ✅ |
| Sub-items and dependencies | Databases 3.13 | ✅ |
| Conditional color | Databases 3.14 | ✅ |
| Inline and linked databases, lock database | Databases 2, 3.1 | ✅ |
| CSV import and export | Databases 3.7–3.8 | ✅ |
| Forms with logic, anonymous answers and sharing | Forms | ✅ |
| Forms anyone can fill in without signing in | Forms | 🟨 FM-D2: yes, per form, off by default |
| Database automations | Automations | ✅; ➖ Admins only (AU-D1) |
| Webhooks in automations | Automations | 🟨 AU-D3: later, tailnet only |
| Email and Slack actions | — | ➖ no email, no outside apps |
| Synced databases (GitHub, Jira) and the public API | — | ➖ no outside connections |

## Knowledge base

| Notion | Care Hub | Status |
| --- | --- | --- |
| Turn a page into a wiki | Knowledge base 3.1 | ✅ |
| Page owners and verification with expiry | Knowledge base 3.2–3.3 | ✅ |
| Draft or published, review notices, Report a problem | Knowledge base 3.2–3.4 | ✅ (Care Hub extras) |
| A separate draft of a published page | Knowledge base | 🟨 KB-D1: later |

## Home, Calendar and Meetings

| Notion | Care Hub | Status |
| --- | --- | --- |
| Home with recent pages, upcoming events and My tasks | Home and reminders 2 🆕 | ✅ |
| Notion Calendar with Google calendars, both ways | Calendar (Google and iCloud) | 🟨 CA-D3: read-only for now (plus iCloud) |
| Replies on Care Hub events, Meet, Teams and Zoom join links, second time zone, week numbers, duplicate, default reminder | Calendar (Google and iCloud) 2–3 🆕 | ✅ |
| Replies to Google and iCloud invitations from inside the calendar app | Calendar (Google and iCloud) 2–3 (synced events show Reply in Google Calendar or Reply in iCloud) | 🟨 CA-D3: Care Hub events only |
| Scheduling links | Calendar (Google and iCloud) | 🟨 CA-D2: later |
| Meeting notes with transcription | Meetings | ✅ (transcription stays in the browser) |
| All meeting notes and notes templates | Meetings 2–3 🆕 | ✅ |
| AI meeting summaries | Meetings | ⏳ Phase 5 (Claude) |

## Admin, security and settings

| Notion | Care Hub | Status |
| --- | --- | --- |
| Members, invite links, roles, groups, removing members | Settings and members 3.4 | ✅; 🟨 SM-D2: a removed member's private pages |
| 2-step verification | Settings and members 3.1 | 🟨 SM-D1: optional; Admins can require it |
| Appearance (dark mode), time zone, start page | Settings and members 3.2 | ✅ |
| Other languages | Settings and members 3.2 | 🟨 SM-D3: later |
| Security settings (guests, share links, export, moving pages out) | Settings and members 3.5 | ✅ |
| Audit log | Settings and members 3.5 (Security log) | ✅ |
| Workspace and page analytics | Analytics | ✅; 🟨 AN-D3: no opt-out of view recording |
| Data retention | Data settings 3.1 | ✅ |
| Status page | Status page | ✅ |
| SAML single sign-on, SCIM, joining by email domain | — | ➖ one server on the tailnet; people join by invite link |
| Plans, billing and seats | — | ➖ self-hosted |

## Apps and integrations

| Notion | Care Hub | Status |
| --- | --- | --- |
| Notion AI | Claude features with the Use Claude permission | ⏳ Phase 5 |
| Notion Mail | — | ➖ no email |
| Integrations, connections and the public API | — | ➖ no outside connections |
| Web clipper | — | ➖ not planned |
| Desktop and phone apps | Care Hub in the browser, on computers and phones (add to Home Screen for push) | ➖ no app-store apps |
| Learning (Care Hub extra) | Learning | ⏳ Phase 4 |

## Decisions for Felipe

- 🟨 **PC-D1** Pages that open with no connection at all, as Notion's apps allow for pages marked "Available offline". Care Hub already keeps typing through short drops and sends the changes later (Pages and blocks 3.12). **Default:** later.
