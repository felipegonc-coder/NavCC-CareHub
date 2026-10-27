# Comments (web)

The page's comment threads (Comments and mentions spec, section 2), over `/api/comments` (see
`apps/server/src/features/comments/README.md`).

| File                 | What it does                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `api.ts`             | The calls, the query key and the live topic `comments:<pageId>`.                                                  |
| `hooks.ts`           | `useComments(pageId)` (fetched again on `comments.changed`), `useViewer()`, `useCommentActions(pageId)`.          |
| `outbox.ts`          | Comments being sent: faded while they go, "Not sent · Retry · Delete" if they fail. The text is never lost.       |
| `threads.ts`         | Tabs, For me, the two orders, `@` mentions in text, and "5 min ago" times.                                        |
| `composer.tsx`       | The comment box: Enter sends, Shift+Enter starts a new line, Esc cancels, ↑ in an empty box edits your last one.  |
| `thread-card.tsx`    | One thread: what it's on, its comments (Edit, Copy link, Delete after a confirm), Resolve or Reopen, a reply box. |
| `comments-panel.tsx` | `CommentsPanel`: Open and Resolved, All and For me, the order menu. ↑ and ↓ move between threads.                 |

`testServer.ts` fakes the comments API for one page in tests, as the server answers.

## Putting the panel on a page

```tsx
<>
  <ShellHeader>
    <IconButton label="Comments" aria-pressed={open} onClick={() => setOpen(!open)}>
      <MessageSquare aria-hidden />
    </IconButton>
  </ShellHeader>
  {open && <CommentsPanel pageId={page.id} onClose={() => setOpen(false)} />}
</>
```

- The page view places it: a right-hand column beside the content on a computer (it's `md:w-96`), and
  the full screen on a phone.
- `locate` and `onOpenThread` come with the editor: where each thread's text or block is (for "By
  position on the page", and `null` for "The text this was on was deleted."), and scrolling to a
  thread's spot with its 2-second highlight.

## Not here yet

- "Add a comment…" under the title, and starting a thread on text, a block or a property (with the
  editor's comment mark, #216).
- "Avery Lin is replying…", reactions, Suggestions, and bold, links, @ menu, emoji and files in the
  composer.
