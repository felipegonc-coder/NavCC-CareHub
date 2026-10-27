PR 3 of W1-E (Connect calendars: Google, read-only, and private links).

**What's here**
- `migrations/MIGRATION_TS_calendar_connections.sql` (82 lines): three tables.
  - `cal_connections`: one row per connected Google account or private link. It holds the owner, kind, label, account, sealed secret (`v1.` only), status (`ok`, `needs-reconnect`, `error`), a plain last error, the last and next sync, a sync lease, and failures in a row.
  - `cal_connection_calendars`: the calendars of a connection. Each has a colour from the design kit, whether it is synced (`shown`), the layer's switch and place (connected calendars come after Care Hub's own layers, from 100), its time zone, a sync cursor (JSON), and whether it went over the 5,000-event limit.
  - `cal_synced_events`: read-only copies (CA-07), one per calendar and remote id. Each copy keeps a stable id, so items, reminders and cards can point at it. Rough UTC bounds make range reads cheap.
- `connections/schema.ts` (110): Drizzle tables matching the migration.
- `connections/store.ts` (196): adding, listing and removing connections, only ever for their owner (no admin access, RP-D1).
  - Up to 10 connections per person (Limits), even when two are added at once: a per-owner advisory lock and `ConnectionLimitError`, which carries the plain message.
  - New calendars get the next free colours and places, unless a colour is chosen.
  - Lists never include the secret. The account shows masked, such as `a…@example.com`.
  - Removing a connection deletes its calendars (layers) and copies. It returns the removed row so the caller can end the Google grant.
- `connections/layers.ts` (205): synced calendars as layers for W1-B's layer list, with ids `connected:<calendarId>`; changes to colour, switch and order; and a range read of copied events, owner only, with ids `synced:<rowId>`.
- `connections/testing.ts` (test support, 79): sample Google and link connections, plus a helper that adds a copied event.

**Size:** 593 non-test lines (migration 82, schema 110, store 196, layers 205). Test support: testing.ts 79.

**Tests:** store 6 and layers 5, mostly against Postgres: the owner-only rule, admins included; the limit with two adds at once; colours and places; Remove taking the copies with it; and range reads. My sandbox has no Postgres or drizzle-orm, so CI runs these. Locally, tsc finds nothing in these files beyond the missing drizzle-orm module.

**Next:** secrets, event bounds and sync storage (PR 4), the sync engine (PR 5), Google routes (PR 6), the Connected calendars screen (PR 7), and private links end to end (PR 8).

Written from the spec. No code copied from AppFlowy or the old Care Hub.
