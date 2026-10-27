PR 5 of W1-E (Connect calendars: Google, read-only, and private links).

**What's here**
- `connections/sync.ts` (429 lines): the sync engine. It only reads: nothing is ever written to Google or to a link (CA-D3).
  - When: Google every 5 minutes, private links every 15 (CA-10), and on Calendar open when the last look is over a minute old (CA-07). "Sync now" and Retry read one connection at once, for its owner only.
  - Google: the first read takes the primary calendar; other calendars wait until the person picks them. After that only changes are read, with sync tokens, and a full read at least weekly keeps the copies to the window (6 months back, 12 ahead). If Google drops the sync token, it reads everything again.
  - Sign-ins: a running-out access token is renewed before the read, and once more if Google turns it down. The new tokens are sealed again at once. When Google stops the sign-in, the connection says "Google needs you to sign in again." and the person gets one 🔔 notice (CA-12).
  - Busy or failing: backs off (up to 6 hours), and the layer shows the problem after three failures in a row. A problem that won't go away by itself shows at once, and so does any problem with a new link that has never been read, since the link may just be wrong (CA-10). A calendar that isn't shared any more leaves; the others keep syncing.
  - Private links: read through W1-D's `readCalendarLink` with where it left off (`etag`, `Last-Modified`) and the owner's address (for the `self` flag). A not-modified answer keeps the fresher validators. A reader that stops early keeps what it has. Each changed occurrence gets its own id.
  - Messages on layers are plain sentences, never a link (CA-11).
  - Tells the routes which calendars changed, for the live `calendar.changed` nudge.
- `connections/memory-sync-store.ts` (test support): the sync storage in memory, so the engine's tests run without Postgres.

**Size:** 429 non-test lines. Test support: memory-sync-store.ts 253.

**Tests:** 19 sync tests pass locally against the fake Google from PR 2, and tsc is clean.

**Next:** Google routes (PR 6), the Connected calendars screen (PR 7), and private links end to end (PR 8).

Written from the spec. No code copied from AppFlowy or the old Care Hub.
