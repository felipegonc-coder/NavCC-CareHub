# Meetings (server)

Meeting notes for Care Hub events (Meetings spec). So far: Take meeting notes, which makes one
notes page per event occurrence and shares it with the event's workspace attendees. The meeting
notes block (header, Attendees, Video link), following the event, transcripts and the list of all
meeting notes come next.

## Routes (`/api/meetings`)

- `POST /notes`: `{ eventId, occurrence? }` (Calendar's occurrence key, needed when the event
  repeats). Take meeting notes in the event panel and Upcoming (MT-01):
  - 201 `{ notes }` when it made the page, 200 `{ notes }` when the occurrence already had one.
    `notes` is `{ id, pageId }`: IDs only, so the web opens `/p/<pageId>`.
  - Members only: `app.requireMember` answers 403 to guests and people outside the workspace.
  - 403 unless the person is the organizer or an invited member; making the page also needs the
    Create permission (`pages.create`), opening one that's there doesn't. 404 when Calendar
    doesn't find the event or occurrence. 409 until pages are on the server.

## How notes are made

- One page per occurrence: a lock per occurrence inside the transaction makes a second click wait
  for the first one's page and open it, and a unique index backs it up. Each occurrence of a
  repeating meeting gets its own page.
- The page goes under the person's "Meeting notes" page, in their private space (MT-D1). That page
  is made the first time, and again if it's gone; it's kept in `meetings_places`.
- Title: "Team huddle · Oct 27, 2026", the day in the event's own time zone, so it's the same
  whoever clicks. "(No title)" for an event without one.
- It starts with the sections Agenda, Notes, Action items (one empty to-do) and Summary.
- Every workspace attendee (the organizer and invited members) gets Can edit, given in the name of
  the person who made the notes. `meetings_grants` keeps these grants apart from other shares, so
  only they go when someone leaves the event. Someone invited later gets theirs when they open the
  notes.

Tables: `meetings_notes`, `meetings_grants` and `meetings_places`
(`migrations/202610271940_meetings_notes.sql`).

## For Calendar (`index.ts`)

- `registerMeetingEventLookup((db, { workspaceId, eventId, occurrence? }) => MeetingEvent | null)`
  at start-up. `MeetingEvent` has `eventId`, `occurrence`, `title`, `allDay`, `start`,
  `timeZone`, `organizerId` and `memberIds`: the occurrence as it is now (moved or not), its
  organizer, and its invited workspace members without outside guests. Return null when there's
  no such event or occurrence in that workspace; a repeating event needs `occurrence`, a single
  one takes none. Without a lookup every event is 404.

## Tests

`createMemoryNotesStore()`, `createMemoryPages()` and `memoryDb` from `testing.ts` run the service
in memory (`service.test.ts`). `routes.test.ts` runs the route and the store on Postgres, with the
memory pages.

## Stand-ins (`stand-ins.ts`)

- Pages and page content: `corePages` is null until features/pages (`createPage`,
  `getPrivateSpaceId`, `getPageAccess`, `grantAccess`) and features/collab
  (`setPageContentFromMarkdown`) are on main, so Take meeting notes answers 409 and makes nothing.
- `routes.ts` isn't in `app.ts` yet: its line comes with those pieces, since until then the route
  can only answer 403 or 409. The route tests register it themselves.

## Next

- `GET` for the meeting notes block (the header from the event, "Event deleted", the link to the
  previous occurrence's notes), the block's editor node, and the web: Take meeting notes and the
  block.
- Following the event: access for people added and removed (MT-02), the notes page for each
  occurrence on Calendar's items, moving notes when a series splits.
- Standalone blocks and "Also attended" (MT-03), synced events, transcripts, and All meeting notes.
