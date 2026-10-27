# live

Live updates over Server-Sent Events: one stream per browser tab, in-process, best effort, no
replay. Events are nudges (ids, at most 2 KB); clients refetch through the normal,
access-checked APIs.

## Exports (`index.ts`)

| Export                                                              | What it does                                                                                                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type LiveEvent = { type: string; data?: Record<string, unknown> }` | A nudge. Types starting with `live-` are reserved for the web client.                                                                                                               |
| `publishToUsers(userIds, event)`                                    | Sends `event` to every open tab of these users.                                                                                                                                     |
| `publishTopic(topic, event)`                                        | Sends `event` to every tab subscribed to `topic` (`<prefix>:<id>`, such as `chat:<conversationId>`).                                                                                |
| `registerTopic(prefix, canSubscribe)`                               | Makes `prefix` yours. `canSubscribe({ userId, topic })` is checked on subscribe, on reconnect and every 10 minutes; errors and answers slower than 5 s count as no.                 |
| `recheckSubscriptions(userId?)`                                     | Checks that user's topics again now (everyone's when omitted), for example after an access change. Lost topics end with `unsubscribed`; answers from before the change never count. |
| `hasOpenTabs(userId)`                                               | True while that user has at least one tab connected to this server, so push can skip people who have Care Hub open.                                                                 |
| `type CanSubscribe`                                                 | The type of `canSubscribe`.                                                                                                                                                         |
| `liveHub`                                                           | The app-wide hub, for tests and `routes.ts`.                                                                                                                                        |

Publish only after the database commit. Register topics at start-up (for example in your
feature's `routes.ts`).

## Routes (`routes.ts`, mounted at `/api/live`)

Options: `getUserId(request)` returns the signed-in user's id or null (until `request.user`
lands).

- `GET /api/live`: the event stream. Headers turn off caching, transforms and proxy buffering.
- `POST /api/live/topics` with `{ connectionId, add?: string[], remove?: string[] }` (at most 50
  each) returns `{ results: { topic, ok }[] }`.
- Errors use the shared shape `{ error: { code, message } }`: 401 `signed_out`, 400 `invalid`
  (with `details`), and 404 `not_found` when the connection has ended or is someone else's.

## Wire format

| Event                               | Data                                        | Meaning                                                                          |
| ----------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `hello` (first, with `retry: 3000`) | `{ connectionId, heartbeatMs }`             | The stream is open.                                                              |
| `ping` (every 25 s)                 | `{}`                                        | Heartbeat.                                                                       |
| default `message`                   | `{ type, data }` or `{ topic, type, data }` | An app event.                                                                    |
| `unsubscribed`                      | `{ topic }`                                 | Access to a topic was withdrawn at a re-check.                                   |
| `bye`                               | `{ reason: 'replaced' }`                    | Over 5 tabs: the oldest is closed and shouldn't reconnect until it's used again. |

Limits per connection: 100 topics, 100 queued frames or 256 KB. A client that falls further
behind, or stays blocked for two heartbeats, is dropped and reconnects.
