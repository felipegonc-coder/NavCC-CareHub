# W1-E status (S.E.V.E.N) — rewritten 07:55Z Oct 27 (sandbox was reset to a 03:41Z backup; restored from GitHub)
- Repo felipegonc-coder/NavCC-CareHub (GitHub MCP "GitHub"). Lead .../405338c7-cfde-8194-9162-00a9151f06ff; W1-D .../405338c7-cfde-8111-a034-00a9d1eb6d1b; W1-B .../405338c7-cfde-813c-aa1d-00a93f91a4ad. W1-G (web calendar) link: asked lead (Q3).
- PR 2 = #117 (82c8bfc) CI passed, sent to lead; waiting merge.
- PR 3 branch feat/team-calendar-connections-storage @b2d05f0 (no PR yet). Non-test 593. Body must be rewritten (kit/pr3-body.md). When PR 3 is open: get_files on it -> restore PR3 files locally (testing.ts, store.test, layers.test, 3-table migration, PR3 schema/store).
- WIP feat/team-calendar-wip @795620d (06:42Z) = all 17 latest files; restored locally via kit/restore.mjs (blob SHAs verified). Local schema.ts/store.ts are the 6a versions (do NOT push to PR 3/4 branches).
- Restore trick: get_commit detail full_patch per commit (big ones offload to files) + node kit/restore.mjs <root> <json files in order>.
- Sent lead 06:55Z: status + Q3 (web placement: /calendar/connections in web features/calendar/routes.tsx on a `// calendar: connections` line; Settings section later via features/calendar/slots.ts; W1-G's link?) + Q2 still open (web PR in parallel?).
- W1-B: server features/calendar/routes.ts is W1-B's; line `// calendar: connections` -> `await app.register(import('./connections/routes'));`. W1-B adds app.ts line. If I land first, I create routes.ts with my line.
- W1-B API (#168 open): layerSchema {id, kind, name, color, on, order, status ok|error, error {message, action retry|reconnect}|null, database, connectionId}; CALENDAR_CHANGED + calendarChangedSchema {eventId?, layerId?}; idSchema 1..100; instantSchema; layerColorSchema. My schemas -> packages/team-calendar-api/src/connections.ts after #168 merges (draft: kit/drafts/connections.ts).
- Plan: PR 4 sync storage (secrets 91, bounds 64, sync-store 409 + tests) ; PR 5 engine (sync.ts 422 + memory store 253 test support + sync.test) ; PR 6a Google routes (no PATCH; oauth states migration+schema, google-connect, routes, store +rename/reconnect/find) ; 6b PATCH, links, package schemas, docs ; PR 7 web screen.
- Reviewer conditions for CAREHUB_TEST_CALENDAR_ORIGINS: exact loopback origins with port; NODE_ENV test/development only (else ignored + warning); skips only private-address check; test that production ignores it.
- Local checks: tsc -p /data/kit/tsconfig.check.json ; tests: cd /data && NODE_PATH=/vercel/sandbox/node_modules /vercel/sandbox/node_modules/.bin/tsx --tsconfig /data/kit/tsconfig.json --test <files> ; prettier --print-width 100 --single-quote --trailing-comma all
- Push: node /data/kit/mkpush.mjs <branch> <msg> <out.json> <files...> ; payload < 64 KB. Never push mock-google.master.ts.
- Web facts: kit/web-notes.md. Next WIP push due ~09:40Z (only if local changes).

## W1-D link reader (08:00Z msgs)
- readCalendarLink(link, cursor, {ownAddresses, signal?, window?, allowLocalOrigins?}) → {status:'not-modified', cursor} | {status:'ok', events, cursor, complete, calendar{name?,timeZone?}, warnings}. LinkCursor = {etag?, lastModified?} (plain JSON → jsonb). not-modified carries cursor (engine now stores it via applyChanges NO_CHANGES — done locally 08:00Z). Part 5 (readCalendarLink + expandSeries) opens after #203 merges.
- allowLocalOrigins from testCalendarOrigins(settingValue, nodeEnv, warn) in sync/ical/fetch-link.ts (#203). Call once at calendar routes start; bind into readLink closure.
- I must document CAREHUB_TEST_CALENDAR_ORIGINS in docs/team/settings.md AND docs/team/testing/calendar-connections.md, link to fetch-link.ts. Reusable text:
  - `CAREHUB_TEST_CALENDAR_ORIGINS`: comma-separated exact loopback origins with a port, e.g. `http://127.0.0.1:4599` or `http://[::1]:4600`. No hostnames, no paths, no other private ranges; a bad entry throws at startup.
  - Honoured only when NODE_ENV is `test` or `development`. Otherwise ignored, with a warning in the log, and the fetcher ignores the option too.
  - A listed origin skips only the private-address check and may use http. Redirects are checked again on their own origin; the 15-second timeout and 10 MB limit still apply.
- Main now 89b09cf (08:00Z); latest migration 202610270625_comments_threads.sql → PR3 migration must be renamed to a later timestamp at open time (and schema.ts comment). 6a oauth migration after that.
- Local: drizzle-orm not installed → DB test files (store/layers/sync-store/routes tests) can't load locally; only secrets/bounds/sync/oauth/client/map tests run. vitest shim now has describe.skipIf.
