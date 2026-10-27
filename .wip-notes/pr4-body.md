PR 4 of W1-E (Connect calendars: Google, read-only, and private links).

**Stacked on #357** (tables and storage). Draft until #357 merges; then I point it at `main`.

**What's here**
- `connections/secrets.ts` (91 lines): seals Google sign-ins (including refresh tokens) and private links with AES-256-GCM and `CALENDAR_SECRET_KEY` (32 bytes, base64; CA-11). Each seal gets a new random nonce, and the connection's row is the associated data, so a sealed value only opens for that row. Without a valid key, connections are off with a plain message. Sealed values never leave the server.
- `connections/bounds.ts` (64): rough UTC bounds for a copied event, so range reads only load what might show. Wall-clock times widen by 14 hours on each side and all-day events last their days. A series ends at UNTIL or stays open. Extra dates and moved occurrences are covered, and unreadable times fall in every range rather than losing the event.
- `connections/sync-store.ts` (409): what a sync run reads and writes, in Postgres.
  - Leases, so two runs never read one connection at once, and a crashed run lets go when its lease runs out. Due connections go most overdue first, skipping ones that wait for a sign-in. "Sync now" leases one connection for its owner. Opening Calendar leases one only when it's due, or fine and not read in the last minute.
  - Follows the outside calendar list: new calendars get the next colours and places, names and zones follow the outside calendar, and calendars that are gone leave with their copies.
  - A full read replaces a calendar's copies but keeps the ids of events that are still there. A change read writes new versions only, and a removed series takes its occurrences with it. Hidden calendars get no writes.
  - Keeps the 5,000 events nearest to now and marks the calendar as cut short (Limits).
  - Records how a run went, unless the person signed in again during the run.

**Size:** 564 non-test lines (secrets 91, bounds 64, sync-store 409). No new test support.

**Tests:** secrets 4 and bounds 5 pass locally. The sync-store tests (9) need Postgres, so CI runs them. Locally, tsc finds nothing in these files beyond the missing drizzle-orm module.

**Next:** the sync engine with time and size limits on every Google call (PR 5), shared connection schemas and sign-in states tied to the signed-in session (PR 6), Google routes (PR 7), the Connected calendars screen (PR 8), and private links end to end (PR 9).

Written from the spec. No code copied from AppFlowy or the old Care Hub.
