# Messages (server)

Direct chats and groups for members of the workspace (Messages spec). The rules (who can do what, limits, mentions, page cards, system lines) live in `@carehub/team-chat`, shared with the web app; this folder stores chats and serves them. The 🔔 Care Hub chat belongs to the notices feature.

## Routes (`/api/messages`)

Members only (`requireMember`): guests have just their 🔔 chat (RP-D2). Every chat route checks that the person is in the chat now, admins included (RP-D1, MS-10): 404 for a chat or message that doesn't exist, 403 for anyone not in it. Answers that show people carry `people`: `{ [userId]: { name, removed? } }`.

| Route | Body or query | Answer |
| --- | --- | --- |
| `GET /chats` | `?unread=true` (only chats that count toward the badge: unread messages, or unread @mentions when muted), `&limit=` (1–100) | `ChatListResponse`: `viewerId` and the person's chats, latest message first, with `unread` and `mentions` counts |
| `GET /unread` | | `UnreadResponse` `{ count }`: the Messages part of the sidebar badge (MS-06) |
| `GET /people` | | `PeopleListResponse`: everyone the person can message (members of the workspace, not guests or removed people), by name |
| `POST /chats` | `{ userIds, name?, startNew? }` | `NewChatResponse` `{ chatId, existing }`: 201 for a new chat, 200 for an existing one |
| `GET /chats/:chatId` | | `ChatResponse`: `viewerId`, the chat and names |
| `GET /chats/:chatId/messages` | `?before=` or `?after=` (a `seq`), `&limit=` (1–50, default 50) | `HistoryResponse`: oldest first, with `hasMore` |
| `POST /chats/:chatId/messages` | `{ clientId, text, pageIds? }` | `MessageResponse`: 201, or 200 for a resend with the same `clientId` |
| `PATCH /messages/:messageId` | `{ text, pageIds? }` | `MessageResponse` |
| `DELETE /messages/:messageId` | | 204, also when it was already deleted |

- **New chats:** one person opens the pair's only direct chat. Two or more start a group (3 to 50 people, name up to 100 characters), unless a group with exactly these people exists and `startNew` isn't set ("Open existing chat"). Guests, people outside the workspace and removed people can't be picked (400).
- **Sending:** text up to 4,000 characters, checked here too (MS-14). `clientId` is a UUID made in the browser: a resend after a dropped connection answers with the message saved the first time (MS-08). A `clientId` already used in another chat is a 409. A direct chat with someone removed from the workspace takes no new messages (409). Files come in a later part (400 for now).
- **Editing and deleting:** only the sender (MS-05). Deleting erases the text, mentions and cards from the database; "This message was deleted" stays in their place.
- **Order:** each chat numbers its messages 1, 2, 3, … (`seq`) in the order the server saves them.
- **Unread:** messages from others after the person's read marker (`lastReadSeq`), not system lines or deleted messages. Sending marks the chat read up to your message. The badge counts unread messages in unmuted chats and @mentions in muted ones; the 🔔 chat adds its notices on the web.

Request and answer types are in `@carehub/team-chat` (`api.ts`).

## For other features (`index.ts`)

- **Event `messages.message.created`** `{ workspaceId, chatId, messageId, senderId, recipientIds }`, after the commit, once per message (not for resends or system lines). `recipientIds` are the chat's current members except the sender.
- **`getMessageForPush(db, messageId, userId)`** gives what a push notification needs, as that person would see it: chat type and name, sender's name, the text on one line with mentions as names (at most 100 characters), whether it mentions them and whether they muted the chat. Null when they shouldn't be notified: they aren't in the chat now, it's their own message, a system line or deleted.

## Tables

`msg_chats`, `msg_members` (with `last_read_seq`, `muted`, `left_at`) and `msg_messages`, in `migrations/202610271023_messages_chats.sql`. `schema.ts` mirrors them, and `schema.test.ts` checks that the two match.
