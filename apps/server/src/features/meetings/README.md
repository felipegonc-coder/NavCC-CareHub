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
  - 404 when Calendar doesn't find the event or occurrence, and also for anyone who isn't its
    organizer or an invited member, so private events aren't confirmed. Making the page needs the
    Create permission (`pages.create`, else 403) and an occurrence within a year of today (else
    400); opening one that's there needs neither. 409 until pages are on the server.
  - 429 after 20 calls in a minute from one person: one call can make two pages and many grants.

## How notes are made

- One page per occurrence: a lock per occurrence inside the transaction makes a second click wait
  for the first one's page and open it, and a unique index backs it up. Each occurrence of a
  repeating meeting gets its own page.
- The page goes under the person's "Meeting notes" page, in their private space (MT-D1). That page
  is made the first time, and again if it's in Trash, gone or moved to another space; it's kept in
  `meetings_places`.
- Notes pages don't inherit access from "Meeting notes" (`inheritAccess: false`), so sharing or
  moving that page never opens new notes to anyone else: only the note-taker and the attendees.
- Title: "Team huddle · Oct 27, 2026", the day in the event's own time zone, so it's the same
  whoever clicks. "(No title)" for an event without one.
- It starts with the sections Agenda, Notes, Action items (one empty to-do) and Summary.
- Every workspace attendee (the organizer and invited members, at most Calendar's 200) who is a
  current member gets Can edit, given by the person who made the notes. Guests and people who left
  get nothing. `meetings_grants` keeps these grants apart from other shares, so only they go when
  someone leaves the event. Someone invited later gets theirs, given by the meeting, when they open
  the notes. A share the note-taker removes stays removed: the grant's row stays.

Tables: `meetings_notes`, `meetings_grants` and `meetings_places`
(`migrations/202610271940_meetings_notes.sql`).

## Transcription (`transcripts/`)

Private, in-browser transcription (MT-06): the browser turns the audio into lines with speech
model files the server keeps.

- `GET /transcription`: `{ available, bytes }`, plus `message` when it's off. Available when
  `MODELS_DIR` points at a folder with model files; `bytes` is what the browser downloads once.
- `GET /models/<file>`: a file from that folder, read only. Only regular files directly in it with
  plain names (letters, digits, `.`, `-`, `_`; no `..`, hidden files, subfolders or links);
  anything else is 404. Kept by the browser for a year (`immutable`, with an ETag), so a new model
  comes with new file names.
- Members only: guests get 403. Model files never go in the repository.

## For Calendar (`index.ts`)

- `registerMeetingEventLookup((db, { workspaceId, eventId, occurrence? }) => MeetingEvent | null)`
  at start-up. `MeetingEvent` has `eventId`, `occurrence`, `title`, `allDay`, `start`,
  `timeZone`, `organizerId` and `memberIds`: the occurrence as it is now (moved or not), its
  organizer, and its invited workspace members without outside guests (at most `LIMITS.people`).
  `occurrence` is Calendar's own key for it, whatever form the request used: notes are kept by
  that key. Return null when there's no such event or occurrence in that workspace, or when the
  occurrence is more than a year from today; a repeating event needs `occurrence`, a single one
  takes none. Without a lookup every event is 404. Meetings also refuses new notes beyond that
  year itself (400).

## Tests

`createMemoryNotesStore()`, `createMemoryCore()` and `memoryDb` from `testing.ts` run the service
in memory (`service.test.ts`); the memory core follows 0007's inheritance, so tests can ask who
can open a page. `routes.test.ts` runs the route and the store on Postgres, with the memory core's pages and
core's memberships (`createUser`, `getMembership`).

## Stand-ins (`stand-ins.ts`)

- Pages and page content: `notesCore` is null until features/pages (`createPage` with
  `inheritAccess`, `getPagePlace`, `getPrivateSpaceId`, `grantAccess` with a meeting as the
  source) and features/collab (`setPageContentFromMarkdown`) are on main, so Take meeting notes
  answers 409 and makes nothing. Its `isMember` is `isCurrentMember`, which asks core's
  `getMembership` already.
- `routes.ts` isn't in `app.ts` yet: its line comes with those pieces, since until then the route
  can only answer 403, 404 or 409. The route tests register it themselves.

## Next

- `GET` for the meeting notes block (the header from the event, "Event deleted", the link to the
  previous occurrence's notes), the block's editor node, and the web: Take meeting notes and the
  block.
- Following the event: access for people added and removed (MT-02), the notes page for each
  occurrence on Calendar's items, moving notes when a series splits.
- Foreign keys once `pages` and `access_grants` are on main: `page_id` with `ON DELETE CASCADE`,
  so a deleted notes page frees its occurrence, but no cascade from `grant_id`, so a removed share
  stays removed.
- Standalone blocks and "Also attended" (MT-03: workspace members only, deduped, at most 100, with
  the same membership check before any grant), synced events, transcripts, and All meeting notes.
