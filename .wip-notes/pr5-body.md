PR 5 of W1-E (Connect calendars: Google, read-only, and private links).

STACK_NOTE

**What's here**
- `connections/sync.ts` (431 lines): the sync engine. It only reads. Nothing is ever written to Google or to a link (CA-D3).
  - When: Google every 5 minutes, private links every 15 (CA-10), and on Calendar open when the last look is over a minute old (CA-07). "Sync now" and Retry read one connection right away, for its owner only.
  - Google: the first read takes the primary calendar, and other calendars wait until the person picks them. After that only changes are read, with sync tokens. A full read at least weekly keeps the copies to the window (6 months back, 12 ahead). If Google drops the sync token, it reads everything again.
  - Sign-ins: an access token that's running out is renewed before the read, and once more if Google turns it down. The new tokens are sealed again straight away. When Google stops the sign-in, the connection says "Google needs you to sign in again." and the person gets one 🔔 notice (CA-12).
  - Busy or failing: it backs off (up to 6 hours), and the layer shows the problem after three failures in a row. A problem that won't go away by itself shows at once. So does any problem with a new link that has never been read, since the link may just be wrong (CA-10). A calendar that isn't shared any more leaves, and the others keep syncing.
  - Private links: read through W1-D's `readCalendarLink`, starting from where the last read left off (`etag`, `Last-Modified`) and using the owner's address (for the `self` flag). A not-modified answer keeps the fresher validators. A reader that stops early keeps what it has. Each changed occurrence gets its own id. A calendar too complex to read in time backs off like a failed fetch.
  - Messages on layers are plain sentences, never a link (CA-11).
  - Tells the routes which calendars changed, for the live `calendar.changed` nudge.
- **Limits on every call to Google** (security review):
  - `sync/google/http.ts` (+43): 10 seconds per call, reply included, together with the run's own cancel. Replies are read as a stream and counted, so a reply over its limit stops with a plain error and nothing is half-read. A declared size over the limit stops before reading.
  - `sync/google/oauth.ts` (+41): token exchange, refresh and revoke get the time limit and a 1 MB reply limit. A timeout says "Google didn't answer in time. Care Hub will try again shortly."
  - `sync/google/client.ts` (+27): every Calendar API read gets the time limit and a 10 MB reply limit. A slow call is tried again like a network failure. An oversized reply isn't tried again. Event pages ask for 1,000 events, so a normal page stays well under 10 MB.
- `connections/memory-sync-store.ts` (test support): the sync storage in memory, so the engine's tests run without Postgres.

**Size:** 542 non-test lines (sync 431, http +43, oauth +41, client +27). Test support: memory-sync-store.ts 253.

**Tests:** 20 sync tests against the fake Google from PR 2, plus 8 for the limits (http 4, client 3, oauth 1). All 80 calendar connection and Google tests pass locally, and tsc and Prettier are clean.

**Next:** shared connection schemas and sign-in states tied to the session (PR 6), Google routes (PR 7), the Connected calendars screen (PR 8), and private links end to end (PR 9).

Written from the spec. No code copied from AppFlowy or the old Care Hub.
