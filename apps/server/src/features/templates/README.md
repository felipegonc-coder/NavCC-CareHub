# Templates (server)

The template gallery, Care Hub's starter templates and the "/button" block's server side
(Templates and buttons spec; Extras lane, decision 0400). Tables start with `tpl_`.

## Routes (`/api/templates`)

| Method and path                         | What it does                                                                          | Needs                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /`                                 | Gallery: cards the person may see, categories, `canSave`                              | Member                                      |
| `GET /:id`                              | Read-only preview: the card, its pages, the top page's Markdown                       | Member who may see it (404 otherwise)       |
| `POST /`                                | Save as template `{ pageId, name, description, category, audience, includeSubpages }` | `templates.manage` and Can view on the page |
| `PATCH /:id`, `DELETE /:id`             | Rename, Change category, Who can use it; Delete (workspace templates only)            | `templates.manage`                          |
| `PUT /:id/hidden`, `DELETE /:id/hidden` | Hide a starter for everyone, or show it again                                         | Admin settings (`workspace.admin`)          |
| `POST /:id/use`                         | Use template `{ target, includeSampleRows }` → `{ pageId, notCopied }`                | `pages.create` and Can edit where it goes   |

Buttons (`/api/templates/buttons`):

| Method and path            | What it does                                                                                 | Needs                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `POST /`                   | A new button block `{ pageId, settings? }` → the button (its ID goes in the block)           | Can edit on the page (not locked)         |
| `GET /:id?pageId=`         | Settings, the plain sentence, `canEdit`, `canPress` and `reason`, the last 50 runs (editors) | Can view on the page                      |
| `PUT /:id`                 | Edit button `{ pageId, settings }`                                                           | Can edit on the page (not locked)         |
| `POST /:id/press`          | `{ pageId, runId?, from }` → page steps, failure, the next confirmation, `undoUntil`         | Who can press it, plus each step's access |
| `POST /runs/:runId/cancel` | Cancel in a confirmation                                                                     | The person who pressed it                 |
| `POST /runs/:runId/undo`   | Within 8 seconds: reverses the row changes nobody changed since → `{ kept, messagesSent }`   | The person who pressed it                 |

`:id` is a workspace template's UUID or a starter's key (`meeting-notes`). Templates saved for
Members of a space are seen only by that space's members and their maker; "Only me" templates
only by their maker. Others get 404, so nothing leaks.

## How a template is kept

A template keeps its own copy of each page (`tpl_template_pages`): title, icon and the collab
feature's Markdown, where blocks without a Markdown form are kept whole as placeholder comments.
Links between the template's own pages are stored as `{{template-page:<key>}}` tokens, so each
copy's links point to the new copies. Variable chips (`templateVariable`) are filled in when the
template is used. Databases are copied on use with the Databases lane's `duplicateDatabase`.
A starter's databases (Projects, Agents, QA reviews and the rest) are written out in
`@carehub/extras/templates` and made on use with `createDatabase`: new ids, Me and Today
filled in for the sample rows, and the row templates kept as they are.
Changing or deleting a template never changes pages made from it; `tpl_made_from` keeps
"Made from Weekly huddle" for the page's Updates (`getMadeFrom`).

## How a button runs

The block keeps only the button's ID (editor node `actionButton`); settings and runs are in
`tpl_buttons` and `tpl_button_runs` (last 50). Pressing checks what it can first (Can edit for
Insert blocks, locked page, pages to open, links, up to 50 people and Admin-only audiences), then
runs the steps up to the next confirmation in one transaction (`runRowWrites`). A 403 from a row
step undoes everything and answers 403 ("You can't add rows to Tickets."); a 404 or 400 stops
there ("Couldn't finish step 2: Tickets is in Trash.") and keeps the earlier steps. Insert blocks,
Open a page and Open a link come back as `pageSteps` for the page to do, only those before a
failure. Messages go out after the commit. Save as template copies the buttons of the saved pages
into the template; Use template gives the new pages their own copies; a page copied with Duplicate
gets its own copy the first time it's opened (`copied_from`).

## Stand-ins

`core.ts` holds everything templates need from features that aren't on main yet. Each piece
refuses until it's bound (403, or "missing" and 404), and is marked `// stand-in: <what replaces it>`:

- the person and their permissions: core's `request.member` (accounts 1b);
- pages, levels, sub-pages, spaces, `createPage`, `setPageTitle`, `getPrivateSpaceId`: pages #49;
- `getPageMarkdown`, `setPageContentFromMarkdown`, `page.updated`: collab #197/#200;
- `saveVersionNow`: history (HT-02);
- `duplicateDatabase`, `createDatabase`, row counts, `runRowWrites`, `createRow`, `updateRows`,
  `findRowIds`, `trashRows` and `readRow`: the Databases lane's `api.ts`;
- the people a button's message reaches (people, groups, roles, everyone): accounts S1.

`sendNotice` is the notices feature's own.

Tests bind fakes with `bindTemplatesCore`. When a feature lands, its line in `core.ts` calls it.
