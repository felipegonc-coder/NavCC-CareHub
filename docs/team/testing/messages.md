# Messages: notes for browser tests

For the Testing lane's flows in `tests/e2e/flows/messages` and the smoke flow in
`tests/e2e/team/messages.e2e.ts`. The page object there (`messages-page.ts`) finds everything by
role and name; the `data-testid` values below are for anything it can't. Fictional data only.

## Paths

| Path                                     | What shows                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/messages`                              | The chat list (🔔 Care Hub first, then chats by latest message). On desktop, "Pick a chat, or start one with New message." beside it. |
| `/messages/<chatId>`                     | That chat, beside the list (on phones, on its own with Back).                                                                         |
| `/messages/care-hub`                     | The 🔔 Care Hub chat (the notices feature draws its notices).                                                                         |
| `/messages?new=1`                        | Opens New message (also Ctrl+K → "New message").                                                                                      |
| `/messages?q=<words>`                    | Opens message search with those words (Ctrl+K → "Search messages" opens it empty).                                                    |
| `/messages/<chatId>?message=<messageId>` | That chat, scrolled to the message and highlighted for 3 seconds (search results and notifications).                                  |

## Roles and names

- **New message:** the only button named "New message" in `main`, at the top of the list.
- **Chat rows:** links in the navigation "Chats"; each link's text starts with the chat's name, then the time, the preview and the unread count ("2 unread").
- **Open chat:** a level 2 heading with the chat's name ("Care Hub" for the 🔔 chat), and on phones the link "Back to chats".
- **Chat menu:** the button "Chat options" → menu items "Rename", "Add people", "People" and "Leave" (groups only), "Mute" (or "Unmute") and "Mark as unread" (once someone else has written).
- **Group dialogs:** Rename has the textbox "Group name" and Save (blank shows the members' names). Add people says "They'll see earlier messages." and has the same combobox "Search people" and list "People" as New message, without the people already in the group, and the button "Add". People lists everyone in the group with "(you)", "Can remove people" and, for whoever can remove people, a button "Remove <name>" each. Leave asks "Leave <chat name>?" with the button "Leave".
- **Mentions:** typing "@" and the start of a name in the message box shows the list "People to mention" (the others in the chat); ↑/↓ and Enter or Tab pick one, Esc closes it. A sent "@Avery Lin" for someone in the chat is a mention.
- **Message box:** the textbox "Message <chat name>". Enter sends, Shift+Enter starts a new line, ↑ in the empty box edits your last message, Esc cancels an edit. A counter shows from 3,800 characters ("200 characters left").
- **Messages:** list items in the list "Messages", with day headings ("Today", "Yesterday", "Mon, Oct 26"), the line "New messages" and "(edited)". Each message's menu is the button "Message from <name>, <time>: actions" → "Copy text", and for your own "Edit" and "Delete". Delete asks first: the dialog "Delete this message?" with "Cancel" and "Delete"; then "This message was deleted" stays.
- **On their way:** "Sending…", "Will send when you're back online." (offline), or "Not sent · Retry · Delete".
- **New message dialog:** the combobox "Search people" and the list "People", one option per person (name and job title; picked ones are selected). With 2 or more people, the textbox "Group name (optional)". The button is "Open chat" for one person and "Start group" for more; when a group with exactly these people exists, "Open existing chat" and "Start new group".
- **Empty states:** "No messages yet. Start a chat with New message." and, in an empty direct chat, "Say hello to Avery.".
- **Search:** the search box "Search messages" at the top of the list (Ctrl+Shift+F goes to it; Esc clears it). The button "Filters" shows the comboboxes "From", "In", "Date" and "Has" (each named with its choice, such as "From: Anyone"), "Clear filters" once one is set, and for On, Before, After and Between the date fields "Day" (or "First day" and "Last day"). While searching, the region "Search results" has the headings "Chats" (chats whose name or members match, without filters) and "Messages": links whose text starts with the sender ("You" for your own) and the chat, then the time and the text with the matching words marked. "No messages match." comes with "Clear filters" when filters are set. ↓ in the box moves into the results, ↑ and ↓ move through them, Enter opens one.
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
| `messages-rename`, `messages-add-people`, `messages-people`, `messages-mute`, `messages-mark-unread`, `messages-leave`                            | Menu items                                                                            |
| `messages-rename-dialog`, `messages-rename-input`, `messages-rename-save`                                                                         | Rename                                                                                |
| `messages-add-people-dialog`, `messages-add-people-save`                                                                                          | Add people (and the New message picker's values)                                      |
| `messages-people-dialog`, `messages-member`                                                                                                       | People, one row per person                                                            |
| `messages-leave-dialog`, `messages-leave-confirm`                                                                                                 | Leave's confirm dialog and its Leave button                                           |
| `messages-mention-list`                                                                                                                           | The "@" list above the message box                                                    |
| `messages-chat-loading`, `messages-chat-unavailable`                                                                                              | Loading bubbles; "This chat doesn't exist." (404) or "You're not in this chat." (403) |
| `messages-message-list`, `messages-message`, `messages-message-text`, `messages-message-menu`                                                     | The scrolling list, a message, its text, its menu button                              |
| `messages-system-line`, `messages-new-line`, `messages-pending`                                                                                   | A change line, the "New messages" line, a message on its way                          |
| `messages-jump-latest`                                                                                                                            | "Jump to latest"                                                                      |
| `messages-empty-chat`                                                                                                                             | "Say hello to …"                                                                      |
| `messages-composer`, `messages-composer-input`, `messages-send`, `messages-save-edit`                                                             | The message box, its textbox, Send, Save (editing)                                    |
| `messages-cant-send`                                                                                                                              | Instead of the box, in a direct chat with someone removed from the workspace          |
| `messages-delete-dialog`, `messages-confirm-delete`                                                                                               | Delete's confirm dialog and its Delete button                                         |
| `messages-new-dialog`, `messages-people-search`, `messages-person-option`, `messages-group-name`, `messages-start-chat`, `messages-open-existing` | New message                                                                           |
| `messages-search`, `messages-search-filters-toggle`, `messages-search-filters`                                                                    | The search box, the Filters button, the filters                                       |
| `messages-filter-from`, `messages-filter-in`, `messages-filter-date`, `messages-filter-has`, `messages-filter-day`, `messages-filter-last-day`    | The filters                                                                           |
| `messages-search-results`, `messages-search-chats`, `messages-search-messages`, `messages-search-result`                                          | The results, the matching chats, the matching messages, one message                   |
| `messages-searching`, `messages-search-empty`, `messages-search-status`                                                                           | "Searching…", "No messages match.", the status region with the count                  |
| `messages-announcer`                                                                                                                              | The status region screen readers hear                                                 |

## JSON routes

Under `/api/messages`, signed in as a member (guests get 403). The full table, with bodies and answers, is in `apps/server/src/features/messages/README.md`; the types are in `@carehub/team-chat` (`api.ts`).

- `GET /chats` (`?unread=true&limit=5` for Home), `GET /chats/:chatId`, `GET /chats/:chatId/messages?before=<seq>`
- `POST /chats` `{ userIds, name?, startNew? }` → `{ chatId, existing }`
- `POST /chats/:chatId/messages` `{ clientId, text }` (a UUID; sending again with it doesn't make a second message), `PATCH` and `DELETE /messages/:messageId`
- `POST /chats/:chatId/read` `{ seq }`, `POST /chats/:chatId/unread`, `PATCH /chats/:chatId` `{ muted?, name? }`
- `POST /chats/:chatId/members` `{ userIds }` (add people to a group), `DELETE /chats/:chatId/members/:userId` (remove someone, or your own ID to leave)
- `GET /unread` → `{ count }` (the Messages part of the badge), `GET /people` (who can be messaged)
- `POST /search` `{ q, fromUserId?, chatId?, date?, has? }` → `{ results, hasMore, people }`: the newest 50 matching messages from chats you're in now (`date` is `{ op: 'on' | 'before' | 'after', date }` or `{ op: 'between', from, to }`, in your own days)

Changes reach open tabs as the live event `messages-changed` `{ chatId }`.

## Seeded names

Messages adds no seed data yet: the flows start their own chats with New message, with names from
`uniqueName()`. They use the seeded people (admin Avery, editor Eli, commenter Casey, viewer Val).
