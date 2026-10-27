# Specs

_Copied from the Notion spec on 2026-10-27. If they differ, Notion wins. Specs marked (in Notion) below aren't copied here._

> 📐 Ready-to-build specs for the Care Hub rebuild: 🆕 **Phase 1 workspace features that match Notion**, **Phase 2** (databases, formulas and forms) and **Phase 3** (team tools, the knowledge base and 🆕 Claude features). Written only from the plan, the Feature list, Look and feel, Builder rules and the answered decisions. Draft v2 · Oct 27, 2026 · Fictional data only.
> **Build order:** Phase 1 first, then Phase 2 (Databases, Messages and the rest), then Phase 3. Messages is listed under Phase 3 but is built early, alongside Phase 2. 🆕 Claude features is listed under Phase 3 too (Phase 5 in the plan), with every feature switched off by default.

## How to use these specs

- Every spec has the same parts: What it's for · Screens and states · Behavior and edge cases · Data it stores · Permissions · Keyboard and phone · Acceptance checks · Decisions.
- If something isn't written here, it's out of scope. Ask; don't guess.
- 🟨 marks an open decision: build the suggested default until it's answered. ✅ marks an answered one. All of them are in the table at the bottom.
- 🆕 marks what v2 added to a spec that already existed.
- Acceptance checks have IDs (DB-01, FM-01…). Each pull request lists the checks it covers.
- 🆕 **Done means:** every spec has a short list just above its acceptance checks: things to try in the browser with fictional data, with ⭐ on what the team will notice first. Each item uses its acceptance-check ID, so tests and the test results all use the same IDs. A new check takes the next free number in its spec. Areas without a spec use DK (look and feel), SH (app shell), AC (accounts and sign-in) and LN (Learning). Checks that cross several areas are the flows below (FLOW-01…).
- 🆕 **Goal (Oct 27):** Care Hub does everything Notion does, plus its own extras (Messages, Calendar, Meetings, Status page, Learning, Claude). The Notion parity checklist, at the bottom of this page, maps each Notion feature to the spec and section that covers it, and lists what Care Hub does differently on purpose.

## Rules for every spec

| Topic | Rule |
| --- | --- |
| Time | Stored in UTC, shown in the person's time zone (profile setting; default America/Denver). Dates look like "Oct 26, 2026" and times like "3:30 PM"; 24-hour time is a personal setting. Weeks start on Sunday unless the person changes it. |
| Loading | Show a skeleton only if loading takes more than 300 ms. |
| Empty | One short sentence plus the main action, shown only if the person may do it. |
| Error | Say what went wrong in plain words and offer Retry. Never lose what the person typed. |
| No access | "You don't have access to this." Never show the title or any content. |
| Not found | "This was deleted, or the link is wrong." |
| Offline | Banner: "You're offline. Changes that need the server are paused." Reconnect automatically. |
| Saving | Changes save on their own and show at once. If the server refuses one, undo it on screen and say why in a toast. |
| Live updates | Changes by other people appear within 2 seconds without reloading. |
| Undo | Deletes show an Undo toast for 8 seconds unless a spec says otherwise. |
| Permissions | Checked on the server for every request; hiding a button is only a convenience. Each spec has at least one check where a direct request must be refused (HTTP 403). Words such as Admin, Full access and Can edit are defined in Roles and permissions. |
| Notices | Reminders, automations and alerts arrive in each person's 🔔 Care Hub chat (see Messages). |
| 🆕 Uploads | Every upload follows Data settings and the build contract (docs/decisions/0007, section 4.3): 100 MB per file by default, programs refused, SVG only as a picture, location data removed from photos. |
| Keyboard | Everything works without a mouse, with a visible focus outline. Esc closes the top pop-up and returns focus to what opened it. Menus use arrows, Enter and type-to-search. Ctrl means Cmd on a Mac. Every drag has a keyboard and a menu alternative. |
| Screen readers | Every control has a name; changes are announced politely; WCAG 2.1 AA. |
| Phone | Phone means narrower than 768 px; tablet 768–1023 px. Touch targets at least 44 × 44 px. Long-press replaces right-click. Pop-ups become bottom sheets; side panels become full screens with Back. |
| Look | Follow Look and feel. Status is never shown by color alone; add an icon or a word. |
| Limits and speed | When a limit is reached, say which one and what to do. Speed targets assume the team's own server with about 30 people at once. |
| Tracking | Only Analytics records what people do, and only as its spec says. |
| Test data | Fictional people and businesses only, in examples, tests and screenshots. |
| 🆕 Notion parity | Same abilities as Notion, in Care Hub's own design and words. Never copy Notion's code, text, icons or screenshots. Where a spec differs from Notion on purpose, it says so. |

## Assumed from Phase 1

Accounts and sign-in, workspaces, file storage, live co-editing and nightly backups. 🆕 Every other Phase 1 feature has its own spec in the Phase 1 section below (account and sign-in screens are in Settings and members). Where Phase 1 was already built differently, raise it before changing it.

## The specs

### 🆕 Phase 1 · Workspace (Notion parity)

- [Pages and blocks](./pages-and-blocks.md)

- [Sidebar, spaces and nested pages](./sidebar-spaces-and-nested-pages.md)

- [Search](./search.md)

- [Comments and mentions](./comments-and-mentions.md)

- [Page history and Trash](./page-history-and-trash.md)

- [Templates and buttons](./templates-and-buttons.md)

- [Import and export](./import-and-export.md)

- [Settings and members](./settings-and-members.md)

Templates and buttons and Import and export also have Phase 2 parts (database templates, the Button property, CSV), marked in each spec. Sharing (access levels, the share dialog, guests, share links) is in Roles and permissions and is part of Phase 1. Comments and mentions sends its notices with sendNotice into the 🔔 chat.

### Phase 2 · Databases and forms

- Databases (in Notion)

- [Formulas](./formulas.md)

- Forms (in Notion)

### Phase 3 · Team tools

- Messages (in Notion)

- Home and reminders (in Notion)

- Calendar (Google and iCloud) (in Notion)

- Meetings (in Notion)

- [Roles and permissions](./roles-and-permissions.md)

- Automations (in Notion)

- Analytics (in Notion)

- Status page (in Notion)

- [Knowledge base](./knowledge-base.md)

- [Data settings](./data-settings.md)

- Claude features (in Notion)

## 🆕 Cross-area flows

Checks that run through several areas. Try each one end to end in the browser with fictional data; each gets one row on the Care Hub test results page, titled with its FLOW ID. A new flow takes the next free number.

- **FLOW-01 Page → share → comment mention → notice.** Avery shares the page Shift handover with Sam and mentions @Sam in a comment. → Sam gets one 🔔 notice with the snippet, and its link opens the exact spot. (RP-16, CM-08, MS-09)
- **FLOW-02 Database → form → automation → calendar.** Riley submits the Callback request form; an automation messages the new row's owner; Callbacks is a database layer in Calendar. → One new row, one 🔔 message within 10 seconds, and the callback on the calendar at its date and time. (FM-02, AU-12, CA-04)
- **FLOW-03 Assign course → take → certificate.** Phase 4 (Learning): an Admin assigns a course, the learner takes it and gets a certificate. The steps come with the Learning spec. (LN, HR-04)
- **FLOW-04 Import → search → history.** Import a Notion export of Support handbook with its 3 databases, search for a phrase from one of its pages, edit that page, then restore the imported version. → The page tree, databases and links come back (formulas listed as problems), search finds the phrase, and Restore brings back the imported text. (IE-04, SR-09, HT-02)
- **FLOW-05 Meeting → notes → action item → reminder.** Avery makes Team huddle with Sam and a Zoom link, takes meeting notes and adds the to-do "@Sam call Blue Pine Plumbing" with tomorrow's date; Sam adds a reminder to that date. → Sam gets the invite, sees Join on Home 10 minutes before the start, finds the to-do under My action items, and gets the reminder in 🔔 at its time. (CA-06, HR-02, MT-01, MT-15, HR-16)
- **FLOW-06 Button → row → automation → message.** On the page QA desk, Avery clicks the button New QA review, which adds a row to QA reviews from its template, while the automation "Row added to QA reviews → message the row's Team lead" is on. → One new row with the template filled in, and the Team lead gets a 🔔 message within 10 seconds. (TB-09, AU-12)
- **FLOW-07 Knowledge base review.** With test data, Refund policy is verified until today. → At 9:00 AM in the owner's time zone it turns Expired, the owner gets a notice in 🔔 and readers see the banner; Review now → Verify for 90 days brings the badge back, and the page ranks above an equal unverified page in search. (KB-05, KB-06, KB-07, KB-12)
- **FLOW-08 Guest and share link → turn off.** Share Onboarding plan with the guest Casey (Can comment) and make a share link with sub-pages off. Casey comments, and a signed-out visitor opens the link; then remove Casey and turn off the link. → Members see Casey's comment; the visitor gets the page read only with sub-pages locked; Casey is signed out within 5 seconds of removal; the link then says "This link isn't active." (RP-18, RP-19, RP-21)

## Not in these specs

- Learning (Phase 4) gets its own spec later, including Claude's Learning help.
- What Care Hub leaves out on purpose (email, outside integrations and the public API, single sign-on, app-store apps, custom domains) is listed in the Notion parity checklist with the reason.

## Decisions

| ID | Question | Suggested default | Answer |
| --- | --- | --- | --- |
| DB-D1 | Formulas, rollups and column totals aren't on the Feature list. Add them? | Later | ✅ Now · Databases 3.9–3.11 and the Formulas spec |
| DB-D2 | Row-level access, e.g. agents see only their own QA reviews? | Later | ✅ Now · Databases 3.12 |
| DB-D3 | Should CSV import also update existing rows with the same Name? | No: imports only add rows | ✅ Default: add only |
| DB-D4 | Tell people in their 🔔 chat when they're added to a Person property? | Yes | ✅ Default: yes |
| FM-D1 | Allow anonymous form responses? | No: every response records its sender | ✅ Yes · a setting per form, off by default (Forms, Anonymous responses) |
| MS-D1 | Pictures and files in messages, reactions, and message search? | Later | ✅ Now · Messages section 3 |
| MS-D2 | Notifications when Care Hub isn't open, including phones (web push)? | Yes | ✅ Default: yes |
| CA-D1 | Set up a Google sign-in client (about 20 minutes)? | Yes; if Google refuses the Care Hub address, everyone uses the Apps Script bridge | ✅ Default: yes |
| MT-D1 | Where do meeting notes live, and who can open them? | Note-taker's private space, shared with the event's attendees as Can edit | ✅ Default |
| RP-D1 | Can Admins open other people's private spaces, chats, private events and transcripts? | No, never | ✅ Default: no, never |
| AU-D1 | Who can manage automations? | Admins only | ✅ Default: Admins only |
| AU-D2 | More automation triggers and actions (form responses, dates, creating pages, a view's rows)? | Later | ✅ Now · Automations section 3 |
| AN-D1 | Who can see Analytics? | Admins only | ✅ Default: Admins only |
| AN-D2 | How long to keep activity data? | 1 year | ✅ Default: 1 year |
| ST-D1 | Show overall status and uptime without signing in? | Yes | ✅ Default: yes |
| ST-D2 | An outside alert when the whole server is off? | Later | ✅ Default: later |
| 🆕 PB-D1 | Cover pictures from Unsplash (an outside service that needs a key)? | No: Care Hub's own cover gallery and uploads |  |
| 🆕 PB-D2 | Live link previews that keep updating from GitHub, Jira, Figma or Slack (each needs a sign-in)? | Later |  |
| 🆕 PB-D3 | Download and keep pictures from pasted web content and picture web addresses? | Yes: up to 10 MB each, public addresses only |  |
| 🆕 PB-D4 | Starter list of approved embed sites (Pages and blocks, section 3.10)? | That list; Admins can change it |  |
| 🆕 SR-D1 | Search the text inside uploaded PDF, Word, Excel and PowerPoint files? | Yes |  |
| 🆕 TB-D1 | Care Hub's own starter templates (Templates and buttons, section 3.1)? | That list, with fictional sample text |  |
| 🆕 IE-D1 | Importers that sign in to another service (Notion, Confluence, Trello, Asana, Google Drive) instead of using its export files? | No: files only |  |
| 🆕 SM-D1 | 2-step verification with an authenticator app? | Yes: optional per person; Admins can require it |  |
| 🆕 SM-D2 | What happens to a removed member's private pages? | Hidden for 90 days (back if they rejoin), then deleted |  |
| 🆕 SM-D3 | Languages other than English? | Later: English only for now |  |
| 🆕 DB-D5 | Map view and the Place property (needs maps hosted on the server)? | Later |  |
| 🆕 DB-D6 | Several data sources inside one database? | Later: separate databases and linked views |  |
| 🆕 FM-D2 | Forms anyone on the Care Hub network can fill in without signing in (always anonymous)? | Yes, as a per-form choice that starts off |  |
| 🆕 RP-D2 | Can guests use Messages to chat with members? | No: guests only get their 🔔 chat |  |
| 🆕 RP-D3 | View-only share links anyone on the Care Hub network can open without signing in (Care Hub's version of Publish)? | Yes; Admins can turn them off |  |
| 🆕 AU-D3 | Webhooks to other services? | Later, and only to addresses inside the tailnet |  |
| 🆕 CA-D2 | Scheduling links, so people can book a free time on your calendar? | Later |  |
| 🆕 CA-D3 | Let Care Hub change Google and iCloud calendars (add, edit, move and delete events, reply to invitations; needs write access)? | No: read-only. Synced events can't be edited, moved or replied to in Care Hub and show Reply in Google Calendar or Reply in iCloud |  |
| 🆕 AN-D3 | Let each person turn off the recording of their own page views? | No: views are recorded for everyone; only Admins see them |  |
| 🆕 KB-D1 | A separate draft copy of published knowledge base pages, published all at once? | Later: edits are live, as in Notion |  |
| 🆕 DS-D1 | Should Export everything include other people's private pages, chats and private events? | No |  |
| 🆕 DS-D2 | Default keeping periods for page versions and Trash? | Versions 1 year, Trash 30 days |  |
| 🆕 PC-D1 | Pages that open with no connection at all (offline pages)? | Later: typing already continues through short drops |  |
| 🆕 CL-D1 | Which Claude model? | One model for every feature, named in the server's settings file next to the key (a current Claude Sonnet model) | ✅ Default |
| 🆕 CL-D2 | Monthly limit on Claude requests? | 3,000 a month per workspace; Admins can change it | ✅ Default |
| 🆕 CL-D3 | How long to keep assistant chats? | Until their owner deletes them or the account is removed | ✅ Default |
| 🆕 CL-D4 | May Claude fields fill automatically? | Yes, as a choice per field; new fields start By hand | ✅ Default |

## 🆕 Notion parity

Every Notion feature mapped to the spec and section that covers it, plus what Care Hub does differently on purpose:

- [Notion parity checklist](./parity-checklist.md)

- Care Hub test results (in Notion)

## 🆕 Care Hub help

Plain-English help for the team, one page per area, written from these specs with made-up examples. These pages will be the first pages in the Knowledge base.

- Care Hub help (in Notion)
