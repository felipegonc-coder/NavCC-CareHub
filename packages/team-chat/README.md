# @carehub/team-chat

Message rules shared by the web app and the server for Messages: direct messages, groups and the
🔔 Care Hub chat. Pure TypeScript and zod, with no I/O: callers pass in what the rules need.

## Modules

| Module       | What it has                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `text`       | `normalizeMessageText`, `countCharacters`, `measureMessageText` (counter from 3,800), `checkMessageText` (4,000), `truncateText`   |
| `tokens`     | `<@userId>` mention tokens, `findLinks`, `safeHref`, `pageLinkMatcher`, `parseMessageText` (text, mention, link and page segments) |
| `compose`    | send and edit body schemas, `prepareMessage`, `collectPageCards`, `checkChangeMessage`, `deletedMessageFields`                     |
| `page-cards` | `pageCardDataSchema` (the card API's data), `viewerPageCard` (open, locked with no title, deleted), `cantOpenWarning`              |
| `names`      | `personName` ("(removed)"), `listNames` ("Avery Lin, Sam Ortiz and 2 others")                                                      |

## Conventions

- **Characters** are Unicode code points, as Postgres `char_length` counts them. The 4,000 limit
  applies to the stored text, where a mention is `<@userId>`.
- **IDs** are opaque strings matching `ID_PATTERN`.
- **Errors** are string codes. The web turns them into words; the server into status codes
  (`not-yours` is a 403).
- **Page links** are `/p/<pageId>` on the site's address (the core setting `CAREHUB_PUBLIC_URL`).
  Build one matcher with `pageLinkMatcher({ origins: [CAREHUB_PUBLIC_URL], pathPrefix: '/p/' })`
  and pass it to `prepareMessage` and `parseMessageText`.
- **Page cards** come from the pages feature (`GET /api/pages/:id/card`, a 403 when the viewer
  can't open the page, a 404 once it's deleted). `viewerPageCard` turns that into what each viewer
  is sent, so a locked card never carries the page's title.
