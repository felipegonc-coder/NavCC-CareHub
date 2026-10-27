# Mentions

People mentioned in page text and in comments, and their 🔔 notices (Comments and mentions spec,
sections 3.3 and 5; decision 0007, section 2.4). Group mentions, Reply in a notice and following
come in later pull requests.

## API

| Route                                                               | Needs       | What it does                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/mentions { pageId, blockId, userId, snippet?, notify? }` | Can edit    | The editor sends it when someone types @person into a block. 201 `{ mention }`, its notice due in 10 seconds. The same person in the same block again within 5 minutes answers 200 with that mention and sends nothing more. |
| `DELETE /api/mentions/:id`                                          | Can edit    | 204. The mention was deleted from the text: a notice still waiting won't go.                                                                                                                                                 |
| `GET /api/mentions/can-open?pageId=&userIds=<id>,<id>`              | Can comment | `{ canOpen, cantOpen }` for up to 50 people: the @ menu lists the people in `cantOpen` last, marked "Can't open this page".                                                                                                  |

- Someone who can't open the page: `POST` answers 409 "Riley Chen can't open this page." unless
  `notify` is false ("Mention without notifying"). The editor asks first, and after Share with Can
  view it sends the mention again.
- Mentioning yourself, or `notify: false`, saves a `quiet` mention with no notice.
- Comments: every `<@userId>` in a new or edited comment (from `comment.created` and
  `comment.edited`) becomes a mention, except its author, at most 50 per comment. Each person gets
  one notice per comment, even when an edit mentions them again; people who can't open the page get
  none (`no_access`). Their notices go at once.
- Duplicating, importing and templates never call `POST`, so their mentions notify nobody (CM-13).
- Schemas and response types: `packages/shared/src/mentions.ts`.

## Notices

The `mentions.send` job sends each notice through `sendNotice` and checks again that the person can
open the page. Kind `mention`, the mentioner as `sender` and `actorUserId`, the title "Mentioned you
on a page" or "Mentioned you in a comment" (never the page title), the sentence or the comment's
text (with `<@id>` as @Name), the page card, and Open: `/p/<pageId>#<blockId>` or
`/p/<pageId>?comment=<commentId>` (`blockUrl` and `commentUrl` from `@carehub/shared`). A job that
runs twice updates the same notice (group key `mention:<id>`).

Nothing is sent until the jobs and notices routes are registered in `app.ts` (Team tools is wiring
them). While notices aren't running, the job retries for about two hours. When following lands, a
comment that mentions someone sends them only the mention (CM-08).

Event: `mention.created { mentionId, workspaceId, pageId, userId, by, blockId, commentId, status }`,
after the commit.

## Stand-ins

- Page access comes from the comments stand-in (`../comments/pages.ts`) until the page model (pull
  request #49) is on main. Then a mentions migration adds the foreign keys to `pages` (ON DELETE
  CASCADE) and `workspaces`.
