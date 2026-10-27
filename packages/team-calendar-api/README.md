# @carehub/team-calendar-api

Request and response shapes for the Calendar API, as zod schemas with their types. The server
checks requests with them; the web app reads responses with them. All routes are under
`/api/calendar`, need a signed-in member, and answer errors as decision 0007 says.

## Values

- Timed items use exact moments in UTC (`'2026-10-27T16:00:00.000Z'`) and the event's own time
  zone. Show them in the viewer's zone with team-time's `toCivil`.
- All-day items use dates (`'2026-11-05'`), which never shift. `end` is exclusive: a one-day event
  on Nov 5 ends on `'2026-11-06'`.
- An occurrence key is an occurrence's original start in the event's zone (`'2026-10-26T10:00'`,
  or a date for all-day events). It stays the same when the occurrence moves; send it back
  unchanged.
- Repeat rules are `@carehub/team-repeat` rules; `describeRepeat` puts them in words.
- Responses use `null` for missing values, never a missing field.

## Routes

| Route                        | Body or query                                                                                | Answer                    |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------------------------- |
| `GET /items`                 | `itemsQuerySchema`: `from`, `to` (dates in the viewer's zone, `to` exclusive, up to 42 days) | `itemsResponseSchema`     |
| `GET /layers`                |                                                                                              | `layersResponseSchema`    |
| `PATCH /layers/:layerId`     | `layerPatchSchema`: `on`, `color`, `order`                                                   | `{ layer }`               |
| `POST /layers`               | `addDatabaseLayerSchema`                                                                     | 201 `{ layer }`           |
| `POST /events`               | `createEventSchema`                                                                          | 201 `eventResponseSchema` |
| `GET /events/:eventId`       |                                                                                              | `eventResponseSchema`     |
| `PATCH /events/:eventId`     | `editEventSchema`                                                                            | `editResponseSchema`      |
| `DELETE /events/:eventId`    | `deleteEventQuerySchema` (query)                                                             | 204                       |
| `POST /duplicate`            | `duplicateSchema`                                                                            | 201 `eventResponseSchema` |
| `PUT /events/:eventId/reply` | `replyBodySchema`                                                                            | 204                       |
| `PATCH /rows/:rowId`         | `rowDatePatchSchema`                                                                         | 204                       |

- **Items** come from every layer, on or off, each with its `layerId`, so a layer switch needs no
  request. `source` tells the kind: `event` (Care Hub, on My events or Meetings), `synced`
  (Google, iCloud or a private link: always `canEdit: false`), `row` (a database layer) or
  `learning` (all-day and read-only). `canEdit: false` means dragging shows "Read-only".
- **Repeating events:** edits, moves and deletes send `scope` (`one`, `following` or `all`) and,
  for `one` and `following`, the `occurrence`. This and following answers with the new series as
  `split`.
- **Edits** send only the changed fields; `allDay`, `start` and `end` go together, and
  `timeZone` only with them. `repeat: null` stops repeating. This event can't change `repeat`
  or `people`, or move an occurrence to another time zone.
- **Replies** without `occurrence` cover the whole series; with it, Just this event. The note is
  up to 200 characters.
- **Duplicate** makes a Care Hub copy at the same time, and from a series, the series from the
  chosen occurrence's date. People get a new invite; replies and notes stay behind.
- **Errors:** 400 `invalid` (with details), 403 `forbidden` for any change to a synced event or
  to a meeting someone else organizes, 404 `not_found`, 409 `conflict` when the occurrence no
  longer exists ("Reload and try again").

## Live

After a change the server sends `CALENDAR_CHANGED` (`'calendar.changed'`) with
`calendarChangedSchema` data (`eventId` or `layerId`) to everyone who can see it. Refetch the
items, for example under the query key `['calendar', 'items', from, to]`.
