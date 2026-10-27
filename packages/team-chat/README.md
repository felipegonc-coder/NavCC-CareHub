# @carehub/team-chat

Message rules shared by the web app and the server for Messages: direct messages, groups and the
🔔 Care Hub chat. Pure TypeScript and zod, with no I/O: callers pass in what the rules need.

## Modules

| Module         | What it has                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`         | `normalizeMessageText`, `countCharacters`, `measureMessageText` (counter from 3,800), `checkMessageText` (4,000), `truncateText`           |
| `tokens`       | `<@userId>` mention tokens, `findLinks`, `safeHref`, `pageLinkMatcher`, `parseMessageText` (text, mention, link and page segments)         |
| `compose`      | send and edit body schemas, `prepareMessage`, `collectPageCards`, `checkChangeMessage`, `deletedMessageFields`                             |
| `page-cards`   | `pageCardDataSchema` (the card API's data), `viewerPageCard` (open, locked with no title, deleted), `cantOpenWarning`                      |
| `names`        | `personName` ("(removed)"), `listNames` ("Avery Lin, Sam Ortiz and 2 others")                                                              |
| `chats`        | `planNewChat`, `planAddPeople`, `planRemovePerson`, `planLeave` (handover), `planRename`, `chatPermissions`, `chatTitle`, `sortChatList`   |
| `system-lines` | `systemEventSchema`, `systemLineText` ("Avery Lin added Sam Ortiz")                                                                        |
| `unread`       | `unreadCounts`, `badgeCount`, `badgeText` ("99+"), `firstUnreadSeq`, `isChatRead`, `advanceReadMarker`, `markAsUnreadSeq`                  |
| `api`          | `newChatBodySchema`, `historyQuerySchema`, and the JSON the server answers with (`ChatJson`, `MessageJson`, `PeopleJson`)                  |
| `notify`       | `notificationSettingsSchema`, `notifyDecision` (tab, push or why not), `notificationContent` and its push payload schema                   |
| `preview`      | `messagePreview`, `attachmentSummary`, `spokenMessage` (screen readers)                                                                    |
| `attachments`  | `attachmentKind`, `storedFile` (HEIC to JPEG), `UploadRules`, `checkNewFiles`, `checkKeptAttachments`, `pictureGrid`, `formatFileSize`     |
| `reactions`    | `normalizeReactionEmoji` (one Unicode emoji), `checkAddReaction`, `reactionToggle`, `reactionChips`, `reactedByText`                       |
| `search`       | `parseSearchQuery`, `toTsQuery`, `searchVector`, `matchesSearch`, `highlightRanges`, `messageHas`, date filters, `messageSearchBodySchema` |

## Conventions

- **Characters** are Unicode code points, as Postgres `char_length` counts them. The 4,000 limit
  applies to the stored text, where a mention is `<@userId>`.
- **IDs** are opaque strings matching `ID_PATTERN`. **`seq`** grows with every message in a chat (a
  bigserial works); a read marker is the last read `seq`.
- **Errors** are string codes. The web turns them into words; the server into status codes
  (`not-yours`, `not-in-chat` and `cannot-remove-people` are 403s).
- **Page links** are `/p/<pageId>` on the site's address (the core setting `CAREHUB_PUBLIC_URL`).
  Build one matcher with `pageLinkMatcher({ origins: [CAREHUB_PUBLIC_URL], pathPrefix: '/p/' })`
  and pass it to `prepareMessage`, `parseMessageText` and `messageHas`.
- **Page cards** come from the pages feature in bulk (`POST /api/pages/cards { ids }`).
  `viewerPageCard` turns each answer into what its viewer is sent, so a locked card never carries
  the page's title.
- **Links** end at a space, a control character or an invisible formatting character (`\p{Cf}`,
  such as U+202E), so a link always goes where it reads. Message text keeps those characters.
- **Upload limits** come from the uploads feature as `UploadRules` (Data settings spec).
- **Search:** store `searchVector([text, ...fileNames])` with `$1::tsvector` (GIN index) and match
  with `search @@ $1::tsquery` using `toTsQuery(parseSearchQuery(q))`. Words are folded and split
  here, so no Postgres text search configuration or `unaccent` is needed and highlighting matches
  the server. Page card titles are never indexed, so search can't reveal a locked page.
