# Templates and buttons

_Copied from the Notion spec on 2026-10-27. If they differ, Notion wins._

> 🧩 Phase 1 · Notion parity · Depends on: Pages and blocks, Roles and permissions (the Templates permission) · Phase 2 parts: database templates, repeating templates, the Button property and the row actions (Databases, Formulas) · Shares its action list with Automations · Used by: Forms, Knowledge base, Sidebar (Templates)

## 1. What it's for

Starting from something good instead of a blank page, and doing several steps with one click. This covers the template gallery (Care Hub's own starter templates plus the workspace's), templates inside databases (default per view, and repeating), template variables such as Today and Me, and buttons, both as a block in pages and as a database property.

## 2. Screens and states

- **Template gallery** (Templates in the sidebar, Templates on a new empty page, or New page ▾ → From template): a search box; categories on the left (Made in this workspace, then Care Hub's: Meetings, Projects, Knowledge, Team, Support, Planning, Forms); cards in the middle with a picture of the page, name, a one-line description and "by Care Hub" or "by Sam Ortiz". Clicking a card opens a read-only preview, listing what comes with it ("3 sub-pages, 1 database with 6 sample rows"). Use template shows an "Add to:" picker (where the gallery was opened from, or Private).
- **Save as template** (page menu): name, description, category (pick or type a new one), who can use it (Everyone in the workspace, or Members of a space), include sub-pages (on by default), Save.
- **Editing a workspace template:** gallery → card menu → Edit template opens the template page with a purple banner "You're editing the template Weekly huddle. Changes only affect new pages." Card menu also has Rename, Change category, Who can use it, Delete.
- **Database templates** (New ▾ in a database, Databases): the templates in order, the default marked "Default", each with "…" (Edit, Duplicate, Set as default for this view, Set as default for all views, Repeat, Delete), and "+ New template". A template opens as a row page with the banner "You're editing a template in Tickets."
- **Empty row page:** under the title, "Start with:" the database's templates and Empty. Typing hides the list.
- **Button block** ("/button"): a button with an icon and a label. Hovering shows ⚙ (Edit button), which opens the settings: label, icon, color (default, gray, brown, orange, yellow, green, blue, purple, pink, red), Who can press it, the actions in order (Add action, drag to reorder) and a plain sentence under them: "When pressed: add a row to Tickets with Status New and Assignee as the person who pressed it, then open it."
- **Button property** (Databases): the same settings, from the property's settings.

| State | What shows |
| --- | --- |
| Button running | A spinner on the button; more presses are ignored |
| Button done | A ✓ for 2 seconds, and "Done · Undo" for 8 seconds if it changed anything |
| Button failed | "Couldn't finish step 2: Tickets is in Trash." Later steps didn't run |
| Button can't be pressed | Greyed out with the reason on hover ("Only people who can edit this page") |
| Button without actions | Greyed out, "Add an action" for people who can edit it |
| No database templates | "No templates yet." with + New template |
| Template too big to save | "Templates can hold up to 500 pages and 1 GB." |

## 3. Behavior and edge cases

### 3.1 Template gallery

- **Care Hub starters** (🟨 TB-D1), written for Care Hub with fictional sample text: Meeting notes, Weekly huddle, 1:1 notes, Project brief, Project tracker (database), Task board (database), Decision record, How-to guide, Policy page, Team wiki (a knowledge base), New hire onboarding (a checklist with sub-pages), Incident review, Shift handover, Content calendar (database), Request form, Feedback form and Event sign-up (forms).
- 🆕 **Customer Care starters** (named in the Feature list; part of TB-D1), under Support, each a database with 3 fictional sample rows: **Agents** (Name, Person, Team, Team lead, Start date, Status: Active, On leave or Left; views All agents and By team); **QA reviews** (Review, Agent, Reviewer, Team lead, Date, Channel: Phone, Chat or Email, Score 0–100, Status: Draft, Shared or Escalated, Ticket link, Notes; views All reviews, By agent and My reviews, where Agent is Me; it comes with the row rule "Agent → Can view" from Databases section 3.12, which changes nothing until a group is set to Only rows they're in); **Coaching conversations** (Conversation, Agent, Coach, Date, Focus, Agreed actions, Follow-up date, Status: Planned or Done; views Upcoming and My conversations, where Agent or Coach is Me; new rows start from a template with the headings What went well, What to work on and Agreed actions). The Feature list's Tasks is the Task board starter, and its Meeting notes is the one above.
- **Using a template** makes a full copy at the chosen place: content, sub-pages, databases with their properties, views, templates and sample rows, and files. Links inside point to the copies; template variables are filled in (section 3.3); comments and history aren't copied. A template with databases has "Include sample rows" (on by default).
- The copy gets the access of where it's put (Roles and permissions); sharing isn't copied. Database rules that belong to the structure, such as row access and hidden properties, are copied.
- **Workspace templates are copies, not links.** Changing or deleting a template never changes pages made from it. Each page made from one says so in its Updates ("Made from Weekly huddle").
- Starter templates can't be changed, but Admins can hide any of them for the workspace (card menu → Hide for everyone).
- Form templates make a database with a Form view (Forms).
- The gallery's own search looks at names, descriptions and categories. Templates don't show in workspace search.

### 3.2 Database templates

- A database template is a model row: property values and page content. **New** uses the view's default template, otherwise the database's default, otherwise an empty row. New ▾ picks any template.
- **Apply to an existing row:** the "Start with" list on an empty row page, or page menu → Apply template on any row. Template values only fill empty properties unless "Replace values" is ticked, content is added at the end, and a version is saved first (Page history and Trash).
- **Repeat** (on a template): every day, every weekday, every week on chosen days, every month on a day (1–28 or "last day"), or every year; at a time on the quarter hour, in a chosen time zone; from a start date; ending never, on a date, or after a number of times. Each new row is named with the template's title and the date ("Weekly huddle – Oct 26"), or with a title formula (Formulas). The local time holds across clock changes, as for Automations schedules.
- Repeating rows show "Created by Sam Ortiz (repeating)". If that person loses access to the database or leaves, the repeat pauses and people with Full access on the database get a 🔔 notice. If Care Hub was down at the time, the missed row is made once when it's back, if that's within 24 hours.
- Templates aren't rows: they don't show in views, counts, charts, search or exports. Rows made from them are normal rows and fire "Row added" automations (Automations).
- Up to 50 templates and 10 repeating templates per database.

### 3.3 Template variables

- While editing a template, or the blocks a button inserts, the @ menu has a Variables section: **Today**, **Now**, **Me** (the person using the template or pressing the button) and **This page** (the new page). They show as purple chips and become real values on use: "@Oct 26, 2026", "@Avery Lin".
- In database templates, properties can use them too: a date as Today or Now with an offset ("Today + 3 days"), a person as Me, a relation as This page.
- **Linked views filtered by This page:** in a Project template, a Tasks view filtered "Project contains This page" shows, in each new project, only that project's tasks.
- Mentions made from Me never send notices (Comments and mentions).

### 3.4 Buttons

- Up to 10 actions, run in order. If a step fails, the later steps don't run, earlier changes stay (with Undo), and the message says which step failed and why.

| Action | Where | What it does |
| --- | --- | --- |
| Insert blocks | Block | Adds blocks set up in the button (up to 200), above or below it, with variables filled in |
| Add a row | Both (Phase 2) | Adds a row to a database with chosen values, optionally from one of its templates |
| Edit rows in | Both (Phase 2) | Changes rows of a database matching a filter, up to 500; rows the presser can't edit are skipped and counted ("3 skipped") |
| Edit this row | Property | Sets this row's properties: a value, Today or Now, Me, a formula's result, add or remove options or people, add to a number |
| Open a page | Both | Opens the page made in an earlier step, or a chosen page or view, in this tab, a new tab or the side panel |
| Open a link | Both | Opens an http or https address in a new tab |
| Send a message | Both | A 🔔 notice, as in Automations: to people, groups or a Person property of the row, with text, fill-ins and page cards; up to 50 people. Everyone and roles only on buttons set up by Admins |
| Show a confirmation | Both | A dialog with your text and Continue or Cancel; Cancel stops the run |
| Define variables | Both | Formulas worked out when pressed (Formulas), with Pressed by, Pressed at and This row as inputs |

- **Who can press it:** People who can edit (the page for a block, the row for a property; the default) or Anyone who can view. Either way, each action also needs the presser's own access: pressing "Add a row to Tickets" needs the right to add rows there. Care Hub checks what it can before the first step and, if something isn't allowed, does nothing and says "You can't add rows to Tickets."
- Buttons act with the presser's access, never the setter's. Their changes fire automations; automations can't press buttons.
- **Undo** (8 seconds) reverses the run's changes that nobody has changed since. Sent messages can't be unsent, and the Undo note says so.
- Insert blocks can't run on a locked page ("Unlock the page first"). Buttons are hidden on share-link pages and disabled on archived pages and pages in Trash.
- Duplicating a page, or using a template, copies its buttons; "This page" and pages made inside the copy point to the new copies.
- Each button keeps its last 50 runs (who, when, result, failed step), shown in its settings to people who can edit it.

## 4. Data it stores

- **Workspace template:** workspace, kind (starter or workspace), the template's page (kept apart from the page tree), name, description, category, who can use it (everyone or a space), preview picture, created by and when, times used, hidden (starters).
- **Database template:** database, its row page (values and content), default for (some views or all), order, and repeat settings (kind, days, day of month, time, time zone, start, end, times left, paused, last and next run).
- **Variable chip:** kind (today, now, me, this page) and offset, stored in template content until use.
- **Button:** where it is (page and block, or database property), label, icon, color, who can press it, actions in order with their settings, variables, and the run log (person, time, result, failed step, changes made, for Undo).

## 5. Permissions

| Action | Needs |
| --- | --- |
| Use a gallery template | The Create permission, and Can edit where the copy goes |
| Save as template; edit, rename or delete workspace templates | The Templates permission (and Can view on the page being saved) |
| Hide a starter template | Admin settings permission |
| Use a database template, or apply one to a row | Adding or editing rows (Can edit content) |
| Make, change, delete, set default or repeat database templates | Can edit or Full access on the database (not Can edit content) |
| Set up or change a button block | Can edit on the page |
| Set up or change a Button property | Can edit or Full access on the database |
| Press a button | Its "who can press it" setting, plus each action's own access |

- A direct request to run a button, or to use a template, that the person isn't allowed is refused (403) before anything changes.

## 6. Keyboard and phone

- Gallery: the search box has focus; arrow keys move between cards, Enter opens the preview, Ctrl+Enter uses the template, and Esc closes.
- Buttons are real buttons: Tab reaches them, Enter or Space presses them, and screen readers hear the label, "button", and the plain sentence as the description. Running and done are announced.
- The button settings and the template menus work by keyboard; actions are reordered with Move up and Move down as well as by dragging.
- **Phone:** the gallery is a full-screen list with categories as a dropdown, and the preview is full screen. Buttons work with a tap; their settings are a full screen.

## Done means

Try these in the browser with fictional data. ⭐ marks what the team will notice first. Each check uses its acceptance-check ID from section 7, so tests and results use the same IDs.

1. ⭐ **TB-01** Open the template gallery, search meeting, preview one and choose Use template. → The page appears with its sub-pages, and its links point to the new copies.
2. ⭐ **TB-04** In a Tasks database, click New, then open New ▾. → New uses the view's default template; New ▾ lists every template and Empty.
3. ⭐ **TB-09** Make a button that inserts a checklist, adds a row to Tickets and opens a page, then press it. → All three happen in order, and Undo reverses them.
4. **TB-05** Use a template with Due set to Today + 3 days and Owner set to Me. → The new row has those values filled in.
5. **TB-06** Apply a template to a row that already has a Status. → Only empty properties fill, the content is added at the end, and a version is saved first.
6. **TB-02** Save a page as a template for Members of Support. → Support members see it in the gallery; others don't.
7. **TB-13** Press a button that asks for confirmation, then choose Cancel. → Nothing changes.

## 7. Acceptance checks

- **TB-01** The gallery's categories, search and preview work; Use template copies sub-pages, databases with sample rows (unless left out) and files, and links inside point to the copies.
- **TB-02** A template saved for Members of Support is only seen by them; changing it later doesn't change pages already made from it.
- **TB-03** Without the Templates permission there's no Save as template, and direct requests are refused (403).
- **TB-04** New uses the view's default template, then the database's, then an empty row; New ▾ and the "Start with" list offer every template and Empty.
- **TB-05** Today + 3 days, Now, Me and This page are filled in when a row is made; a Tasks view filtered by This page shows only the new project's tasks.
- **TB-06** Apply template fills only empty properties unless Replace values is ticked, adds content at the end, and saves a version first.
- **TB-07** A template repeating every weekday at 9:00 AM America/Denver makes one row each weekday at that local time, including across the clock change; it stops after the set number of times; it pauses with a notice when its setter loses access.
- **TB-08** Templates don't show in views, counts, search or exports; a row made from a template fires a Row added automation.
- **TB-09** A button with Insert blocks, Add a row and Open a page does all three in order with variables filled in, and Undo reverses them.
- **TB-10** When step 2 fails, step 3 doesn't run and the message names step 2 and the reason.
- **TB-11** A presser who can't add rows to Tickets is told so and nothing changes; a direct request is refused (403).
- **TB-12** A Button property's Edit this row only changes its own row; someone with Can view sees it greyed out (DB-41).
- **TB-13** Cancel in Show a confirmation stops the run with no changes.
- **TB-14** Send a message reaches up to 50 people; Everyone and roles are only offered on buttons set up by Admins.
- **TB-15** Buttons are hidden on share-link pages, disabled on archived pages and in Trash, and Insert blocks is refused on a locked page.
- **TB-16** Everything works by keyboard and screen reader; axe finds no serious problems; the phone layout works.
- 🆕 **TB-17** Each Customer Care starter (Agents, QA reviews, Coaching conversations) makes a database with the properties, views and 3 sample rows in section 3.1; My reviews shows only rows where Agent is the viewer; a new Coaching conversations row starts with the three headings.

## Decisions

- 🟨 **TB-D1** Care Hub's own starter templates, as listed in section 3.1, with fictional sample text (Notion's gallery isn't copied). **Default:** as listed.
