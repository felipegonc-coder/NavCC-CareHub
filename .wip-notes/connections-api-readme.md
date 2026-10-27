## Connections

Connected calendars (W1-E): Google, read-only, and private calendar links. Only the owner sees,
changes, reads or removes a connection, and no answer ever contains a token, a password or a
private link (CA-11). Each shown calendar is the layer `connected:<calendarId>`.

| Route                        | Body                    | Answer                        |
| ---------------------------- | ----------------------- | ----------------------------- |
| `GET /connections`           |                         | `connectionsResponseSchema`   |
| `POST /connections/refresh`  |                         | `connectionsResponseSchema`   |
| `POST /connections/google`   | `googleConnectSchema`   | `googleConnectResponseSchema` |
| `PATCH /connections/:id`     | `connectionPatchSchema` | `connectionResponseSchema`    |
| `POST /connections/:id/sync` |                         | `connectionResponseSchema`    |
| `DELETE /connections/:id`    |                         | 204                           |

- **Google:** `POST /connections/google` answers with Google's sign-in address; send the person
  there. With `connectionId` it reconnects that connection. Google sends the person back to
  `GET /google/callback`, which goes on to `/calendar/connections?connected=<id>`, or
  `?problem=<code>` (`connectProblemMessage(code)` gives the sentence).
- **Refresh:** Calendar calls it when it opens. It reads the connections not read in the last
  minute, waiting up to 8 seconds, then answers with the list.
- **Status:** `needs-reconnect` shows Reconnect; `error` shows `lastError` and Retry
  (`POST /connections/:id/sync`). `truncated` means a calendar has more than 5,000 events in the
  window, so some don't show.
- **Errors:** 400 `invalid`, 404 `not_found` for someone else's connection, and 409 `conflict`
  with a plain message when a way of connecting is off on this server or the calendar is being
  read right now.
