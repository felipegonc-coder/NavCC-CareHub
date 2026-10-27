# Templates (server)

The template gallery, Care Hub's starter templates and, later, the "/button" block's server side
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

## Stand-ins

`core.ts` holds everything templates need from features that aren't on main yet. Each piece
refuses until it's bound (403, or "missing" and 404), and is marked `// stand-in: <what replaces it>`:

- the person and their permissions: core's `request.member` (accounts 1b);
- pages, levels, sub-pages, spaces, `createPage`, `setPageTitle`, `getPrivateSpaceId`: pages #49;
- `getPageMarkdown`, `setPageContentFromMarkdown`, `page.updated`: collab #197/#200;
- `duplicateDatabase`, `createDatabase` and row counts: the Databases lane's `api.ts`.

`saveVersionNow` is History's (it saves no version until pages land).

Tests bind fakes with `bindTemplatesCore`. When a feature lands, its line in `core.ts` calls it.
