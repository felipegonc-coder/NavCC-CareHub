# Messages: notes for browser tests

For the Testing lane's flows in `tests/e2e/flows/messages` and the smoke flow in
`tests/e2e/team/messages.e2e.ts`. The page object there (`messages-page.ts`) finds everything by
role and name; the `data-testid` values below are for anything it can't. Fictional data only.

## Paths

| Path                 | What shows                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/messages`          | The chat list (🔔 Care Hub first, then chats by latest message). On desktop, "Pick a chat, or start one with New message." beside it. |
| `/messages/<chatId>` | That chat, beside the list (on phones, on its own with Back).                                                                         |
| `/messages/care-hub` | The 🔔 Care Hub chat (the notices feature draws its notices).                                                                         |
| `/messages?new=1`    | Opens New message (also Ctrl+K → "New message").                                                                                      |

## Roles and names

- **New message:** the only button named "New message" in `main`, at the top of the list.
- **Chat rows:** links in the navigation "Chats"; each link's text starts with the chat's name, then the time, the preview and the unread count ("2 unread").
- **Open chat:** a level 2 heading with the chat's name ("Care Hub" for the 🔔 chat), and on phones the link "Back to chats".
- **Chat menu:** the button "Chat options" → menu items "Mute" (or "Unmute") and "Mark as unread". Rename, Add people and Leave come with groups (next part).
- **Message box:** the textbox "Message <chat name>". Enter sends, Shift+Enter starts a new line, ↑ in the empty box edits your last message, Esc cancels an edit. A counter shows from 3,800 characters ("200 characters left").
- **Messages:** list items in the list "Messages", with day headings ("Today", "Yesterday", "Mon, Oct 26"), the line "New messages" and "(edited)". Each message's menu is the button "Message from <name>, <time>: actions" → "Copy text", and for your own "Edit" and "Delete". Delete asks first: the dialog "Delete this message?" with "Cancel" and "Delete"; then "This message was deleted" stays.
- **On their way:** "Sending…", "Will send when you're back online." (offline), or "Not sent · Retry · Delete".
- **New message dialog:** the combobox "Search people" and the list "People", one option per person (name and job title; picked ones are selected). With 2 or more people, the textbox "Group name (optional)". The button is "Open chat" for one person and "Start group" for more; when a group with exactly these people exists, "Open existing chat" and "Start new group".
- **Empty states:** "No messages yet. Start a chat with New message." and, in an empty direct chat, "Say hello to Avery.".
- **Screen readers:** new messages from others are read out from a status region ("Avery Lin: Can you check the QA form?").

## `data-testid` values

| Value                                                                                                                                             | Element                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `messages-screen`                                                                                                                                 | The screen's `main`                                                                   |
| `messages-new`                                                                                                                                    | New message button                                                                    |
| `messages-chat-list`, `messages-chat-item`, `messages-unread-count`                                                                               | The chat list, a chat row, its unread count                                           |
| `messages-list-loading`, `messages-no-chats`, `messages-error`                                                                                    | Loading rows, "No messages yet.", a load error with Retry                             |
| `messages-no-chat-open`                                                                                                                           | "Pick a chat…" on desktop                                                             |
| `messages-chat-header`, `messages-chat-title`, `messages-chat-menu`                                                                               | The open chat's header, its name, its menu button                                     |
| `messages-mute`, `messages-mark-unread`                                                                                                           | Menu items                                                                            |
| `messages-chat-loading`, `messages-chat-unavailable`                                                                                              | Loading bubbles; "This chat doesn't exist." (404) or "You're not in this chat." (403) |
| `messages-message-list`, `messages-message`, `messages-message-text`, `messages-message-menu`                                                     | The scrolling list, a message, its text, its menu button                              |
| `messages-system-line`, `messages-new-line`, `messages-pending`                                                                                   | A change line, the "New messages" line, a message on its way                          |
| `messages-jump-latest`                                                                                                                            | "Jump to latest"                                                                      |
| `messages-empty-chat`                                                                                                                             | "Say hello to …"                                                                      |
| `messages-composer`, `messages-composer-input`, `messages-send`, `messages-save-edit`                                                             | The message box, its textbox, Send, Save (editing)                                    |
| `messages-cant-send`                                                                                                                              | Instead of the box, in a direct chat with someone removed from the workspace          |
| `messages-delete-dialog`, `messages-confirm-delete`                                                                                               | Delete's confirm dialog and its Delete button                                         |
| `messages-new-dialog`, `messages-people-search`, `messages-person-option`, `messages-group-name`, `messages-start-chat`, `messages-open-existing` | New message                                                                           |
| `messages-announcer`                                                                                                                              | The status region screen readers hear                                                 |

## JSON routes

Under `/api/messages`, signed in as a member (guests get 403). The full table, with bodies and answers, is in `apps/server/src/features/messages/README.md`; the types are in `@carehub/team-chat` (`api.ts`).

- `GET /chats` (`?unread=true&limit=5` for Home), `GET /chats/:chatId`, `GET /chats/:chatId/messages?before=<seq>`
- `POST /chats` `{ userIds, name?, startNew? }` → `{ chatId, existing }`
- `POST /chats/:chatId/messages` `{ clientId, text }` (a UUID; sending again with it doesn't make a second message), `PATCH` and `DELETE /messages/:messageId`
- `POST /chats/:chatId/read` `{ seq }`, `POST /chats/:chatId/unread`, `PATCH /chats/:chatId` `{ muted }`
- `GET /unread` → `{ count }` (the Messages part of the badge), `GET /people` (who can be messaged)

Changes reach open tabs as the live event `messages-changed` `{ chatId }`.

## Seeded names

Messages adds no seed data yet: the flows start their own chats with New message, with names from
`uniqueName()`. They use the seeded people (admin Avery, editor Eli, commenter Casey, viewer Val).
