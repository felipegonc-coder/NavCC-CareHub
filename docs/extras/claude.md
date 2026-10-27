# Claude features

Spec: [Claude features (Notion)](https://app.notion.com/p/c1116656e6d34bc7b986993564fb5944), checks CL-01 to CL-18. Shared names: `@carehub/extras/claude`. Every Claude PR gets the security reviewer's OK before merge, because it sends content off the server.

## Switches

The features are Writing help (`writing_help`), the Assistant (`assistant`), Claude fields (`fields`), Meeting summary (`meeting_summary`, called by Meetings) and Learning help (`learning_help`, called by Learning; Learning decision 0315). `CLAUDE_FEATURE_LABELS` has the switch names and `CLAUDE_FEATURE_SENDS` what each one sends.

A request goes out only when all of these hold:

1. The server has `ANTHROPIC_API_KEY` (see [settings.md](settings.md)).
2. That feature's switch (`claude.<feature>`) is on. Every switch is off by default, and an update never turns one on.
3. The person has `claude.use`. Guests never do.
4. The person can open every page and row whose text is sent.

Only an Admin turns a switch on, in Settings → Claude, and only through its confirm (spec, section 3.1): it says what the feature sends, adds "Only turn this on with Nav's written OK.", and Turn on stays grey until "Nav has given the OK" is ticked. Without the key, no switch can be turned on. Turning a switch off needs neither. Switch changes go to the Security log (`logSecurityEvent`; for now the app log, see below).

## Server API (`apps/server/src/features/claude/index.ts`)

- `isClaudeFeatureOn(db, workspaceId, feature): Promise<boolean>` checks the key and the switch. `claudeFeaturesOn(db, workspaceId)` does it for every feature at once.
- `askClaude(db, { workspaceId, userId, feature, system, instruction, documents?, selection?, maxTokens? }): Promise<{ text }>`
- `askClaudeJson(db, { ...the same, schema }): Promise<{ data }>` asks for JSON and checks it with the caller's zod schema. If it doesn't match, it throws `bad_output`.
- `ClaudeError` has `reason` (`ClaudeErrorReason`) and plain-words `message`. Routes answer `CLAUDE_ERRORS[reason]` with `details: { reason }`.
- `summarizeMeeting(db, { userId, workspaceId, notesPageId, agenda, notes, actionItems, attendees, transcript? }): Promise<MeetingSummary>` is for Meetings.
  - `MeetingSummary` is `{ summary, decisions: string[], actionItems: { text, owner?, due? }[] }`, checked with `meetingSummarySchema` from `@carehub/extras/claude`. `due` is YYYY-MM-DD; an owner or date Claude can't give properly is left out.
  - It's plain text: show it as text, never as HTML.
  - The person must be able to open the notes page, and the result goes to nobody who can't open the notes.
  - A long transcript is cut to fit; the agenda and notes always go in whole.
- `fillClaudeFields(db, { userId, databaseId, propertyId, rowIds })` is for the Databases field type, once it lands.

The `documents` are `{ title, text }` pairs the **server** loaded by ID after the access check. A caller never passes text a client says came from a page; only the person's own selection comes from the client. The model and the largest `max_tokens` are set on the server. `maxTokens` can only lower that limit for one feature.

The numbers (spec, section 3.6):

- `MAX_TOKENS` is 2,048, and a request holds at most `MAX_REQUEST_CHARS` (60,000) characters.
- A request waits up to 60 seconds for Claude (`REQUEST_TIMEOUT_MS`), retries included. After that it's `unavailable`: "Claude isn't available right now."
- Each person can send 60 requests an hour (`PERSON_REQUESTS`, `PERSON_WINDOW_MS`): "You've asked a lot this hour. Try again in a few minutes."
- The monthly limit is what an Admin saved in Settings → Claude (`claude.monthlyRequests`), or else `CLAUDE_MONTHLY_REQUESTS` (3,000 unless set; CL-D2). It counts the calendar month in America/Denver. At the limit: "Claude has reached this month's limit. An Admin can raise it in Settings → Claude."
- Every request sent is a row in `claude_usage`, failures included. Refusals before sending aren't.

The switches and the monthly limit are what Admins save in Settings → Claude. Until the roles PR (#55) binds `canUseClaude` with `configureClaude`, nobody has `claude.use`, so nothing is sent. Until the page model (#49) binds `pages`, no page counts as open. Tests bind fakes the same way and put the old ones back with the function `configureClaude` returns.

## Settings → Claude (`/api/claude`)

Every route needs a signed-in person (401 otherwise). The shapes are in `@carehub/extras/claude/settings`.

- `GET /status` answers `ClaudeStatus`, `{ on: { writing_help, assistant, fields, meeting_summary, learning_help } }`: what the person can use in their workspace now (the key, the switch and `claude.use`). The web app asks every 5 seconds and hides what's off, so a feature switched off disappears within 5 seconds.
- `GET /settings` answers `ClaudeSettingsView`, for the workspace's Admins only (403 for anyone else):
  - `keySet` says whether the server has the key. The key itself never leaves the server.
  - `model`, `switches`, and `chatRetentionDays`: null for kept until deleted (CL-D3), or 30, 90 or 365.
  - `lastChanged`: for each switch, `{ by, at }` for whoever last turned it on or off (their name, or null once their account is gone) and when, or null if nobody ever has.
  - `usage`: `month` (YYYY-MM in America/Denver), `requests`, `monthlyRequests` (the workspace's monthly limit) and `byFeature`.
- `PUT /settings` takes `ClaudeSettingsUpdate`, also Admins only: any of some or all `switches`, `navOk`, `monthlyRequests` (a whole number from 0 to 1,000,000) and `chatRetentionDays`. Anything else is 400 `invalid`.
  - Turning any switch on needs `navOk: true`, which the web app sends only from that switch's confirm. Without it the answer is 400 `invalid`, 'Tick "Nav has given the OK" to turn a feature on.' Without the key it's 409 `conflict` with `details: { reason: 'not_set_up' }`, and nothing is saved.
  - Only what changed is saved, in one transaction. Saving the server's default limit when none is saved changes nothing.
  - Each change is one security log line, `{ event: 'claude.setting_changed', workspaceId, userId, key, value }`, with `navOk: true` added when a switch turns on.
  - It answers with the new `ClaudeSettingsView`.

Stand-ins until other lanes land (core PR 3):

- **Workspace settings (accounts 1c):** they're kept in `claude_settings`, through `getWorkspaceSetting` and `setWorkspaceSetting` with the names 1c will use. A missing row means off. Who last changed a switch, and when, comes from the row's `updated_by` and `updated_at`. A later migration moves the rows across.
- **Members (#55):** until the roles PR calls `bindClaudeMembers(lookup)`, nobody is a member, so the status is all off and the settings answer 403.
- **Security log (S2):** until `logSecurityEvent` lands, the lines go to the app log under `security`.

### In the web app (`apps/web/src/features/claude`)

- **On or off for the person signed in:** `useClaudeOn(feature)` for components, `isClaudeOn(feature)` for menus that check when they open, and `onClaudeStatusChange(listener)`, all from `features/claude/index.ts`.
  - Everything is off until the server answers, and whenever asking fails, so nothing shows while it's unknown (CL-01).
  - The shell's `claude-status` overlay asks `GET /status` every 5 seconds (not while the tab is hidden), so a feature switched off goes away within 5 seconds (CL-05).
  - Writing help keeps its own flag in step: `onClaudeStatusChange((now) => setWritingHelpOn(now.on.writing_help))`.
- **Settings → Claude** (`/settings/claude`, Admins only through `workspace.admin`):
  - The key's status, never the key: "Key set. Model: …" or "No key. Add it to the server's settings file, then restart Care Hub."
  - The five switches, each with what it sends and who last turned it on or off ("Turned on by Avery Lin on Oct 27, 2026."). Without the key they can't be turned on.
  - Turning a switch on opens its confirm, "Turn on Writing help?", with what it sends and Nav's OK. Turn on stays grey until "Nav has given the OK" is ticked, and the tick is fresh each time. Turning a switch off saves at once.
  - This month's requests out of the monthly limit, with use per feature. The Monthly limit box saves on Enter or when it loses focus; anything but a whole number from 0 to 1,000,000 shows "Use a whole number from 0 to 1,000,000." and isn't sent.
  - How long assistant chats are kept.
  - Each change saves on its own, sending only what changed, and shows "Saved" for 2 seconds. A failure names the field. A 403 shows "You don't have access to this."

## Security rules (security reviewer, Oct 27)

- **One way out:**
  - Only `features/claude/server` calls Claude, with the built-in fetch, `redirect: 'error'`, a 60 s timeout for the whole request with its retries (spec, section 3.6), and the fixed URL `https://api.anthropic.com/v1/messages`.
  - `ANTHROPIC_BASE_URL` may point it at a local stub for tests, and only at loopback addresses.
  - There's no SDK and no new package.
- **The key:**
  - It comes only from server settings.
  - It never goes in the database, the web bundle, logs, errors or answers.
  - On a failure, log only the status and error type, never the request or Anthropic's response body.
  - A test sets a fictional key and checks it appears in no log, error or answer.
- **No tools:** no tools, web access or actions. Adding any later needs a new review.
- **Prompt injection:**
  - Page content is wrapped in a delimiter with a random value per request (or escaped), so page text can't close the quote.
  - Content is labelled as data, not instructions.
- **Output is untrusted text:**
  - No raw HTML. Links go through `safeHref`. No images or embeds are rendered from Claude's output.
  - An accepted suggestion goes through the same checks as typed content: the editor path and #183's `checkUpdate`, or field validation.
- **Limits:**
  - Each workspace has a monthly limit (`CLAUDE_MONTHLY_REQUESTS`, default 3,000; CL-D2), which Admins can change in Settings → Claude. Each person has 60 requests an hour, so one person can't use the whole limit.
  - Each request has a size cap.
  - 429 and 5xx are retried at most twice, with backoff, and only while the 60 s allow it; 4xx otherwise is never retried.
- **Auto-fill (CL-D4, default By hand):**
  - It runs with the field owner's access, only from inputs at least as restricted as the output field.
  - Each database has a cap per hour.
  - A bulk run asks first, showing the row count.
  - It never re-runs on every keystroke.
- **Meeting summaries:** no wider audience than the notes.
- **Usage log:** one row per request, with workspace, person, feature, tokens, status and time. It never holds prompt or answer text. Settings → Claude shows this month's use per feature.
- **Assistant chats:**
  - They're kept until deleted (CL-D3), with a retention option, and deleted with their owner (`ON DELETE CASCADE`).
  - They're visible only to their owner; Admins never open them (RP-D1).
  - Access is checked again when a chat is read.

## Tests

The browser tests use a local stub instead of Claude; see [testing.md](testing.md#claude).
