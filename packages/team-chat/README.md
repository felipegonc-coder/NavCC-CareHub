# @carehub/team-chat

Message rules shared by the web app and the server for Messages: direct messages, groups and the
🔔 Care Hub chat. Pure TypeScript and zod, with no I/O: callers pass in what the rules need.

## Modules

| Module         | What it has                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `text`         | `normalizeMessageText`, `countCharacters`, `measureMessageText` (counter from 3,800), `checkMessageText` (4,000), `truncateText`         |
| `tokens`       | `<@userId>` mention tokens, `findLinks`, `safeHref`, `pageLinkMatcher`, `parseMessageText` (text, mention, link and page segments)       |
| `compose`      | send and edit body schemas, `prepareMessage`, `collectPageCards`, `checkChangeMessage`, `deletedMessageFields`                           |
| `page-cards`   | `pageCardDataSchema` (the card API's data), `viewerPageCard` (open, locked with no title, deleted), `cantOpenWarning`                    |
| `names`        | `personName` ("(removed)"), `listNames` ("Avery Lin, Sam Ortiz and 2 others")                                                            |
| `chats`        | `planNewChat`, `planAddPeople`, `planRemovePerson`, `planLeave` (handover), `planRename`, `chatPermissions`, `chatTitle`, `sortChatList` |
| `system-lines` | `systemEventSchema`, `systemLineText` ("Avery Lin added Sam Ortiz")                                                                      |
| `unread`       | `unreadCounts`, `badgeCount`, `badgeText` ("99+"), `firstUnreadSeq`, `isChatRead`, `advanceReadMarker`, `markAsUnreadSeq`                |

## Conventions

- **Characters** are Unicode code points, as Postgres `char_length` counts them. The 4,000 limit
  applies to the stored text, where a mention is `<@userId>`.
- **IDs** are opaque strings matching `ID_PATTERN`. **`seq`** grows with every message in a chat (a
  bigserial works); a read marker is the last read `seq`.
- **Errors** are string codes. The web turns them into words; the server into status codes
  (`not-yours`, `not-in-chat` and `cannot-remove-people` are 403s).
- **Page links** are `/p/<pageId>` on the site's address (the core setting `CAREHUB_PUBLIC_URL`).
  Build one matcher with `pageLinkMatcher({ origins: [CAREHUB_PUBLIC_URL], pathPrefix: '/p/' })`
  and pass it to `prepareMessage` and `parseMessageText`.
- **Page cards** come from the pages feature (`GET /api/pages/:id/card`, a 403 when the viewer
  can't open the page, a 404 once it's deleted). `viewerPageCard` turns that into what each viewer
  is sent, so a locked card never carries the page's title.
