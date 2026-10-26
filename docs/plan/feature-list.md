# Feature list (everything the new Care Hub does)

_Copied from the Notion plan (the source of truth) on 2026-10-26. If they differ, Notion wins._

> 📋 Everything the new Care Hub will do, grouped by area. Phases match the build order on the main plan. Anything marked **Later** is planned but comes after the rest.

## Accounts and sign-in (Phase 1)

- Sign in with email and password. Care Hub never sends email, so nothing depends on an email service.
- The admin adds accounts one at a time, or up to 200 at once from a CSV file or a pasted list, with a preview first.
- New accounts, and accounts whose password the admin reset, choose their own password at first sign-in.
- Change your own password. The admin can set a new password or remove an account.
- Profile name and picture.
- Add people to a workspace, or take them out, without email. Invite links.
- Clear password rules, a pause after repeated wrong passwords, and "sign out everywhere".
- The Care Hub logo on every sign-in screen.
- Not planned: single sign-on, signing yourself up.

## Workspace and sidebar (Phase 1)

- Workspaces with Spaces: shared team spaces and private spaces, a "+" to add one, and a choice of who can see each.
- Sidebar top: Home, Messages, Calendar and Learning, with a short Upcoming events list underneath.
- Favorites and Recent at the top of the sidebar.
- Page tree: nested pages, drag to move, open and close. "New page" is hidden for view-only roles.
- Templates, Analytics, Trash and Settings in the sidebar.
- Search everything (titles and text) with highlights, from the search box or Ctrl/Cmd + K.
- Home: upcoming events, recent pages, unread messages and the learning assigned to you.
- Links between pages never break, and each page shows which pages link to it.
- Phone and tablet layout with its own menu.
- Everything works with the keyboard, including the sidebar.

## Pages and the editor (Phase 1)

- Page title, icon (emoji or colored icon), cover picture and a Full width switch.
- "/" menu to add any block, "@" to mention people, pages and dates, and shortcuts like # for a heading or \[\] for a to-do.
- Blocks: text, headings, bulleted, numbered and to-do lists, toggle, quote, callout, divider, code, picture (upload, caption, size, description for screen readers), file, video, audio, web embed (approved sites only), simple table, columns (2, 3 or 4), tabs, sub-page, link to a page, and database views inside a page.
- Tabs: icons, text size, drag to reorder, right-click menu, and they remember the open tab.
- Drag blocks to move them. Block menu: duplicate, delete, turn into another block, color.
- Text: bold, italic, underline, strikethrough, code, color and highlight, links.
- Live co-editing: several people in one page at once, with names and cursors. A short connection drop doesn't lose work.
- Comments on pages, with replies.
- Version history: automatic and named versions, preview, and bring an old version back.
- Templates: start a page from one, or save any page as a template for everyone. Starter templates for Customer Care: Agents, QA reviews, Coaching conversations, Tasks and Meeting notes.
- Print or save as PDF (just the page, without menus). Export as Markdown.
- Import Markdown, CSV and Notion export files.
- Trash: restore deleted pages. The admin can empty it automatically after a set number of days.
- Knowledge-base extras (Phase 3): page owner, "review by" date, draft or published, and a "Report a problem" button that goes to the owner's review inbox.

## Databases (Phase 2)

- A database can be its own page or sit inside a page.
- Views: table, board, calendar, gallery, list, chart and form. Each view keeps its own filters, sorting and grouping.
- Property types: text, number, select, multi-select, status, date (with end date and time), checkbox, link, email, phone, person, files, relation (link to rows in another database), checklist, created and edited (time and person), and Claude fields (off by default).
- Filters, including dates like "this week" or "next 7 days". Sorting, grouping, and search inside a database.
- Tables: freeze columns, resize and hide columns, add rows in place. Tables inside pages line up with the page text.
- Each row opens as a page: properties at the top, normal page content below.
- Board: drag cards between columns. Calendar view: drag to change dates.
- Charts (bar, line and pie) from a database.
- Import and export CSV.

## Forms (Phase 2)

- A form view on any database. Each question is a property, and answers arrive as rows.
- Share a form link with workspace members, and change or turn off the link at any time.
- Question descriptions with formatting (bold, italic, underline, colors, links), edited as they look.
- Show a question only when earlier answers match (all or any of several conditions).

## Messages and reminders (Phase 3)

- Direct messages and group chats with people in your workspaces.
- Messages arrive instantly. Unread counts in the sidebar, and browser notifications if you allow them.
- Share pages in a message as cards (page button or "@"). People only see cards for pages they can open.
- A "🔔 Care Hub" chat where reminders, automations and alerts arrive.
- "Remind me" on pages and calendar events, delivered in that chat at the chosen time.
- Works on phones.

## Calendar (Phase 3)

- A full-screen Calendar from the sidebar: day, week (default) and month, a Today button, arrows and a small month picker.
- Layers on the left, each with its own color and an on/off switch: my events, Meetings, any database with a date, Learning due dates and connected calendars.
- Click an empty slot to create an event or meeting. Click an event for a side panel with time, people, a Join Zoom button and its notes page.
- Drag to move or resize events. Your own events are private to you.
- Connect your calendars: Google (two-way through Google sign-in, or a Google Apps Script bridge for company accounts), iCloud (two-way with an app-specific password, stored encrypted), or any calendar's private link (read-only, refreshed every 15 minutes). Passwords and links stay on the server.
- Upcoming panel with the next meeting and a Join button.
- Single-key shortcuts with an on/off switch. Phone layout.

## Meetings (Phase 3)

- "Take meeting notes" on any event, or a meeting notes block: agenda, attendees, Zoom link, notes, action items and summary.
- Private transcription: the speech model runs in your browser, so audio never leaves your computer. Speaker labels. The transcript is private to you.
- Claude summary (short summary, decisions, action items with owners), off until Nav approves.
- Shown in the app: tell everyone before recording. Recordings are deleted once the transcript is saved.
- Later: create Zoom links automatically (needs a Zoom app and Nav's OK), and Teams and Google Meet links.

## Claude (Phase 5, built switched off)

- Assistant panel like Notion AI: floating, side panel or full screen. Each person's chats are private. It can read the open page, or search all the pages you can open.
- Writing help in pages: improve, fix grammar, change tone, shorten, simplify, continue, summarize and draft.
- Claude fields in databases, for example a summary for each row.
- Learning help: writing help in blocks, summaries and key points, quiz questions from a lesson, a first draft of a course from a document, and questions about results (needs Nav's OK).
- An on/off switch for each feature. The API key stays on the server, and nothing runs without it.

## Learning: Rise + Reach for Customer Care (Phase 4)

Who: Learning builders (Felipe, Meagan), Learning analysts (Laura, Aaron), learners (about 30 agents) and the Care Hub admin (Felipe). Three permissions: build trainings, assign trainings and see training analytics. Full details: PRD: Care Hub Learning (Rise + Reach for Customer Care) (Notion) and Learning feature tracker (Notion).

### Studio and blocks

- Add-block menu, drag to reorder blocks and lessons, undo and redo, block templates (save blocks and reuse them), and turn pasted text into tidy blocks (keeps your wording).
- Text and headings, lists, note or callout box, statement, quote, quote carousel and quote on a picture, two-column text, dividers (numbered divider, spacer), code snippet and table.
- Picture (description, caption, size), picture layouts (picture and text, text on a picture, banner), gallery (carousel or grid), labeled graphic (numbered spots on a picture), video, audio, file and web embed.
- Accordion, tabs, timeline, process (step by step), flashcards, sorting activity, buttons (to a page, file or lesson), continue block, knowledge check and scenario (branching practice conversation).

### Questions and quizzes

- Single answer, multiple answer, true or false, matching, drag-and-drop matching, fill in the blank, put in order and click the right spot.
- Final quiz with pass mark, tries, shuffle and question pool. Feedback for each answer. Results with review and retry.
- Shared question banks, surveys (no right answer) and importing questions from a spreadsheet.

### Course settings

- Course types: Standard, Scenario lab, Required read, Microlearning and Certification. Example courses to copy.
- Duplicate, archive, completion rules, lessons in order or free, lesson branching, links to other lessons or blocks, minimum time and read-and-acknowledge sign-off.
- Rename buttons and labels, search inside a course, sidebar open, closed or hidden, versions with roll back, and updates that go live straight away.

### Look and media

- Course cover picture, cover page layouts, lesson icons and header pictures, and dark mode.
- Upload pictures, audio, video and files. Crop pictures. Captions and transcripts.

### Assign and deliver

- Course catalog with search and topics, hide a course from the catalog, and a direct link to a course.
- My learning: continue, assigned with due dates and overdue, finished, and the catalog.
- Assign to people or groups with due dates. Due dates show in the Care Hub calendar.
- Reminders when assigned, due soon and overdue. Certificates, and re-certification when they expire.
- Learning paths (several courses in order), auto-assign by team, and telling people when a finished course changes (or asking them to retake it).

### Tracking and reports

- Reports overview, course report, person transcript, team view for managers, question analysis, drop-off, overdue list and learning path reports.
- Export to CSV, reset a person's progress and mark someone complete by hand.

### Review and teamwork

- Share a draft for review by link, comments on a draft, export review comments, and reminders for authors to check old courses.

### Access, phones and offline

- Keyboard and screen reader support (WCAG 2.1 AA), picture descriptions and a bigger-text option.
- Works on phones and tablets, preview as computer or phone, resume where you left off, and keeps progress if the connection drops.

### Learning, Later (planned, not built yet)

- Import courses from the Learning prototype (waiting on your export file), and play old SCORM course packages (only if you say yes).
- Favorites, a QR code for a course, print a course as PDF, points, badges and leaderboards, classroom sessions with sign-in, and Slack or Teams notices.
- Charts block, free-layout blocks, block animations, course themes, custom fonts and team brand settings.
- One course in many languages, Claude translation and a translation glossary.
- Record narration in the browser and a reusable media library.
- Negative scoring, a skip-ahead pre-test, discussion inside a course, review requests with due dates, several authors editing at once, and extra profile fields for reports.
- Claude: a tutor for learners, branching scenarios from a prompt, pictures, voice-over, captions, bulk rewrite with approval, and video into an interactive lesson.
- A fully offline phone app.

### Learning, not planned

- Storyline-style slides, triggers and variables, custom code blocks, SCORM or xAPI export, selling courses or outside learners, single sign-on, AI avatar videos, stock libraries and HR reviews. The tracker has the reason for each.

## Admin and settings (Phases 1–3)

- Roles: Admin, Editor, Commenter and Viewer, plus your own roles. Permissions: edit, create, comment, share, use Claude, templates and the three Learning permissions.
- Automations that run on the server on a schedule, for example "every weekday at 9:00, message the team", with a "try it now" button.
- Analytics: who opened and edited which pages and when, with charts.
- Data settings: how long to keep page versions, analytics and trash.
- Backups every night (database and files), kept 30 days, with a tested restore. Export everything at any time.
- Status page: is the server up, uptime over 30 days, and whether backups are running.
- The web address is a setting. Error messages say what actually went wrong.
- No limit on the number of people.

## Needs behind the scenes

- Runs on the ThinkCentre (Ubuntu Server) with one start command, updates itself when a new version is built, and is reachable from anywhere through Tailscale.
- Handles the whole team (about 30 people) at once, with pages opening in about a second.
- Security: passwords stored safely, secure sign-in cookies, permissions checked on the server for every request, uploads checked for type and size, embeds only from approved sites, no custom code blocks, and secrets only in the server's settings file.
- Privacy: fictional data until Nav approves, Claude off by default, and recordings never leave your computer.
- Works in Chrome, Edge, Safari and Firefox, on computers, tablets and phones.

## Go live (Phase 6)

- Put Care Hub on the ThinkCentre, with its own web address through Tailscale.
- Import the Learning prototype and Notion exports.
- Invite the team.
