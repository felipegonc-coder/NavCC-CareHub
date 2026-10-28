# Calendar grid layout

Pure TypeScript layout maths for the Calendar's Day, Week and Month screens: no React, no DOM and
no calendar libraries. Import from `./layout`. Date arithmetic and the `CalendarView` and
`WeekStart` types come from `@carehub/team-time`, as do week numbers (`weekNumber`) and the second
time zone's hour labels (`secondZoneHourLabels`).

## Inputs

- Times are civil strings in the viewer's time zone: dates `YYYY-MM-DD`, date-times
  `YYYY-MM-DDTHH:mm`. Convert instants with `@carehub/team-time` first.
- `CalendarItem` is `{ id, allDay, start, end?, declined? }`, with ids unique within one call. A
  timed `end` is exclusive (missing, or before the start: a point in time). An all-day `end` is
  inclusive (missing: one day). `declined` means the viewer answered Not going.
- The functions are generic, so your own objects come back as `item`.
- `visibleItems(items, { hideDeclined })` leaves out declined items when Hide declined events is
  on. Filter first, then lay out.

## Drawing

- `viewRange(view, anchor, options)`: the day columns, what to load and the period for the top
  bar. `navigate(view, anchor, 'previous' | 'next' | 'today', { ...options, today })`.
- `layoutTimeGrid(items, days, { minHeight })`: one list per day column. `top` and `height` are
  minutes from 00:00 (pixels: minutes / 60 × hourHeight); `left` and `width` are fractions of the
  column. Items crossing midnight get one block per day.
- `layoutAllDayRow(items, days, { maxVisible })` and `layoutMonth(items, matrix, { maxVisible })`
  with `matrix = monthMatrix(anchor, options)`: bars in lanes, with `more[dayIndex]` for
  "+N more". `maxVisible: Infinity` draws everything (the expanded all-day row).
- `itemsByDate(items, dates)`: each day's items in reading order (phone Month dots and list).
- `hourAxis(label)` (the formatter decides 12- or 24-hour), `nowPosition(now, days)` and
  `initialScrollMinutes(now, days)` (7:00, or an hour above the now line when later and today is
  shown).

## Editing

- Pointer positions are pixels from the first day column's top-left corner at 00:00, scroll
  included. `slotAt` gives the 15-minute slot under a click; `dragMove` and `dragResize` give the
  new `ItemTimes` to save (resize: null for all-day items).
- Dropping between the all-day row and the hours: `timedAt(start, minutes?)` and `allDayOn(date)`.
  The C shortcut: `timedAt(nextHalfHour(now), defaultLength)`.
- Keyboard: `gridKeyAction(event)` maps arrows, Alt+arrows and Ctrl+D (duplicate: call
  `preventDefault`, as browsers bookmark on Ctrl+D). Edits go through
  `applyEdit(item, step, { skipWeekends })`; focus uses `weekFocusOrder` or `monthFocusOrder`
  with `moveFocus(order, currentKey, move)`.

## Notes

- Moves keep the length on the wall clock, so across a clock change the real length can differ by
  an hour. Clock-change days still draw 24 hour rows (CA-13).
- Overlapping items sit side by side and widen into free columns to their right.
