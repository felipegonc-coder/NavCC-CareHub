# live (web)

The browser side of live updates. One `EventSource` per tab, opened when the first handler
subscribes and closed 10 s after the last one leaves. Events are nudges (ids only): refetch
through the normal APIs, usually by invalidating a TanStack Query key.

## Exports (`index.ts`)

| Export                                 | What it does                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `useLiveEvent(type, handler)`          | Calls `handler` for per-user events of `type` (such as `job-updated`).                                  |
| `useLiveTopic(topic \| null, handler)` | Subscribes the tab to `topic` (`<prefix>:<id>`, nothing while null) and calls `handler` for its events. |
| types `LiveEvent`, `LiveHandler`       | `LiveEvent` is `{ type, data? }`.                                                                       |

Both hooks also call `handler` with `{ type: 'live-reconnected' }` after a reconnect, once the
tab's topics are subscribed again, because events may have been missed: refetch then. The
newest handler is always used, so passing a new function on each render is fine.

## Behaviour

- Reconnects with backoff (1 s, doubling to 30 s, with jitter), and starts over after a
  connection that lasted 30 s. No frame for two heartbeats counts as a dropped stream.
- Topic changes go to `POST /api/live/topics` one request at a time (at most 50 topics each),
  with `X-CSRF-Token` from the `carehub_csrf` cookie. A refused topic isn't asked for again
  until the next connection.
- After `bye` (over 5 tabs) the tab waits until it's used again (focus, visible, online).

## Tests

`testSource.ts` has `createFakeLive()`: a client wired to a fake `EventSource` and topics
endpoint. Install it with `setLiveClientForTest(live.client)` from `client.ts`, and reset with
`setLiveClientForTest(null)`.
