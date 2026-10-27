# Comments

Threads and comments on pages (Comments and mentions spec, sections 3.1 and 5; decision 0007,
section 4.3). Mentions and their notices are in `features/mentions`; reactions, suggested edits and
following come in the next pull requests.

## API

| Route                                                                           | Needs                                       | What it does                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/comments?pageId=&status=open\|resolved\|all`                          | Can view                                    | The page's threads, the newest activity first, each with its comments; `people` (names and pictures by ID) and `canComment`. Each thread says `canResolve`, each comment `canEdit` and `canDelete`.        |
| `POST /api/comments { pageId, text, threadId?, blockId?, quote?, propertyId? }` | Can comment                                 | 201 `{ id, threadId }`. With `threadId` it replies, which reopens a resolved thread. Without, it starts a thread: on a row's `propertyId`, on `blockId` (with `quote`, on that text), or else on the page. |
| `PATCH /api/comments/:id { text }`                                              | Its author                                  | Changes the text and shows "edited".                                                                                                                                                                       |
| `DELETE /api/comments/:id`                                                      | Its author, or Full access                  | 204. A thread's first comment stays as "This comment was deleted" while the thread has others; deleting the last one deletes the thread.                                                                   |
| `PATCH /api/comments/threads/:id { resolved }`                                  | Its starter (with Can comment), or Can edit | Resolves (`true`) or reopens (`false`).                                                                                                                                                                    |

- Errors: 404 when the page is missing or in Trash (also for comment and thread IDs on pages the
  person can't open), 403 below the level needed, 413 at 1,000 threads on a page or 500 comments in
  a thread, 400 for empty text or more than 4,000 characters.
- Text is stored as written (line breaks as `\n`, trimmed), with people mentioned as `<@userId>`,
  as in Messages. Schemas and response types: `packages/shared/src/comments.ts`.
- Text comments: the editor marks the commented text with the thread's ID, so the spot follows
  edits by anyone; `quote` keeps the text for "The text this was on was deleted."
- Live: tabs subscribed to `comments:<pageId>` (Can view) get `comments.changed { pageId, threadId }`
  after every change, then fetch the threads again.
- Other features: `listComments(db, userId, pageId, { limit?, status? })` from `index.ts` (none
  without Can view), and the events `comment.created { commentId, threadId, pageId, workspaceId, by,
newThread }` and `comment.edited` (the same without `newThread`), emitted after the commit.

## Stand-ins

- Page access: `pages.ts` asks a bound lookup for the person's level and the page's workspace.
  Until the page model (pull request #49) is on main nothing is bound, so every page counts as
  missing and the routes answer 404. Then `pageAccess` calls the page model, and a comments
  migration adds the foreign keys to `pages` (ON DELETE CASCADE) and `workspaces`.
