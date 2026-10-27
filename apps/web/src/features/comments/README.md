# Comments (web)

The page's comment threads (Comments and mentions spec, section 2), over `/api/comments` (see
`apps/server/src/features/comments/README.md`). The comments panel built on these comes next.

| File           | What it does                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `api.ts`       | The calls, the query key and the live topic `comments:<pageId>`.                                                 |
| `hooks.ts`     | `useComments(pageId)` (fetched again on `comments.changed`), `useViewer()`, `useCommentActions(pageId)`.         |
| `outbox.ts`    | Comments being sent: faded while they go, "Not sent · Retry · Delete" if they fail. The text is never lost.      |
| `threads.ts`   | Tabs, For me, the two orders, `@` mentions in text, and "5 min ago" times.                                       |
| `composer.tsx` | The comment box: Enter sends, Shift+Enter starts a new line, Esc cancels, ↑ in an empty box edits your last one. |

`testServer.ts` fakes the comments API for one page in tests, as the server answers.
