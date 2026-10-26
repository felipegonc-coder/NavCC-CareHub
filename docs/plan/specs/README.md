# Specs

_Copied from the Notion spec (https://app.notion.com/p/46a3bb9cb57a49c283778189759ad1c5) on 2026-10-26. If they differ, Notion wins._

> 📐 Builder-ready specs for **Phase 2** (databases and forms) and **Phase 3** (team tools), written only from the plan, the Feature list, Look and feel, and Builder rules. Draft v1 · Oct 26, 2026 · Owner: Felipe Gonçalves · Fictional data only.
> **Build order:** Databases and Messages first (builders start Oct 27), then the other eight.

## How to use these specs

- Every spec has the same parts: What it's for · Screens and states · Behavior and edge cases · Data it stores · Permissions · Keyboard and phone · Acceptance checks · Decisions.
- If something isn't written here, it's out of scope. Ask the lead; don't guess.
- 🟨 marks a decision for Felipe. Build the suggested default until he answers. All of them are in the table at the bottom.
- Acceptance checks have IDs (DB-01, FM-01…). Each pull request lists the checks it covers.

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
| Keyboard | Everything works without a mouse, with a visible focus outline. Esc closes the top pop-up and returns focus to what opened it. Menus use arrows, Enter and type-to-search. Ctrl means Cmd on a Mac. Every drag has a keyboard and a menu alternative. |
| Screen readers | Every control has a name; changes are announced politely; WCAG 2.1 AA. |
| Phone | Phone means narrower than 768 px; tablet 768–1023 px. Touch targets at least 44 × 44 px. Long-press replaces right-click. Pop-ups become bottom sheets; side panels become full screens with Back. |
| Look | Follow Look and feel. Status is never shown by color alone; add an icon or a word. |
| Limits and speed | When a limit is reached, say which one and what to do. Speed targets assume the ThinkCentre with about 30 people at once. |
| Tracking | Only Analytics records what people do, and only as its spec says. |
| Test data | Fictional people and businesses only, in examples, tests and screenshots. |

## Assumed from Phase 1

Accounts and sign-in, workspaces and spaces, page sharing, the editor (mentions, comments, version history), search, Trash, templates, file uploads and their limits, and nightly backups. If Phase 1 was built differently from what these specs assume, the lead raises it before building.

## The specs

### Phase 2 · Databases and forms

- Databases (Notion: https://app.notion.com/p/fe27d484cabc4a74ae11028f8d43465f)

- Forms (Notion: https://app.notion.com/p/6640881fdf6d41c390c8576c2c971b1d)

### Phase 3 · Team tools

- Messages (Notion: https://app.notion.com/p/84c02e9eba544420970996db06a9a68f)

- Home and reminders (Notion: https://app.notion.com/p/bda69660a9d34590887bba1180991aff)

- Calendar (Google and iCloud) (Notion: https://app.notion.com/p/ae60ffd8078a4cfab963361d5a1df3ed)

- Meetings (Notion: https://app.notion.com/p/4fb6dd42b5f848959d183610f9b00c08)

- [Roles and permissions](./roles-and-permissions.md) (Notion: https://app.notion.com/p/d2e6352004d64a9b93a0b3ee29ee4259)

- Automations (Notion: https://app.notion.com/p/27672fb82e7543e7b64bd47594d4d751)

- Analytics (Notion: https://app.notion.com/p/e59dc98c61c24fcf83b4f1ce3d1f37d1)

- Status page (Notion: https://app.notion.com/p/bccdd11e277f481ea07f11a47d557d8a)

## Not in these specs

- The knowledge-base extras (Phase 3: page owner, review-by date, draft or published, Report a problem) and Data settings weren't part of this brief and still need specs.

## Decisions for Felipe

| ID | Question | Suggested default | Felipe's answer |
| --- | --- | --- | --- |
| DB-D1 | Formulas, rollups and column totals aren't on the Feature list. Add them? | Later |  |
| DB-D2 | Row-level access, e.g. agents see only their own QA reviews? | Later |  |
| DB-D3 | Should CSV import also update existing rows with the same Name? | No: imports only add rows |  |
| DB-D4 | Tell people in their 🔔 chat when they're added to a Person property? | Yes |  |
| FM-D1 | Allow anonymous form responses? | No: every response records its sender |  |
| MS-D1 | Pictures and files in messages, reactions, and message search? | Later |  |
| MS-D2 | Notifications when Care Hub isn't open, including phones (web push)? | Yes |  |
| CA-D1 | Set up a Google sign-in client in your personal Google account (about 20 minutes; builders give the steps)? | Yes; if Google refuses the Care Hub address, everyone uses the Apps Script bridge |  |
| MT-D1 | Where do meeting notes live, and who can open them? | Note-taker's private space, shared with the event's attendees as Can edit |  |
| RP-D1 | Can Admins open other people's private spaces, chats, private events and transcripts? | No, never |  |
| AU-D1 | Who can manage automations? | Admins only |  |
| AU-D2 | More automation triggers and actions (form responses, dates, creating pages, a view's rows)? | Later |  |
| AN-D1 | Who can see Analytics? | Admins only |  |
| AN-D2 | How long to keep activity data? | 1 year |  |
| ST-D1 | Show overall status and uptime without signing in? | Yes |  |
| ST-D2 | An outside alert when the whole ThinkCentre is off? | Later |  |
