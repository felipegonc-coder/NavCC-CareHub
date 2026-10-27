# Claude features

Spec: [Claude features (Notion)](https://app.notion.com/p/c1116656e6d34bc7b986993564fb5944), checks CL-01 to CL-18. Shared names: `@carehub/extras/claude`. Every Claude PR gets the security reviewer's OK before merge, because it sends content off the server.

## Switches

The features are writing help in pages (`writing_help`), the assistant panel (`assistant`), Claude fields in databases (`fields`), meeting summaries (`meeting_summary`, called by Meetings) and Learning help (`learning_help`, called by Learning).

A request goes out only when all of these hold:

1. The server has `ANTHROPIC_API_KEY` (see [settings.md](settings.md)).
2. An Admin has ticked "Nav has given the OK" (`claude.navApproved`) in Settings → Claude.
3. That feature's switch (`claude.<feature>`) is on. Every switch is off by default.
4. The person has `claude.use`. Guests never do.
5. The person can open every page and row whose text is sent.

Switch and approval changes go to the Security log (`logSecurityEvent`; for now the app log, see below).

## Server API (`apps/server/src/features/claude/index.ts`)

- `isClaudeFeatureOn(db, workspaceId, feature): Promise<boolean>` checks the key, the approval and the switch. `claudeFeaturesOn(db, workspaceId)` does it for every feature at once.
- `askClaude(db, { workspaceId, userId, feature, system, instruction, documents?, selection?, maxTokens? }): Promise<{ text }>`
- `askClaudeJson(db, { ...the same, schema }): Promise<{ data }>` asks for JSON and checks it with the caller's zod schema. If it doesn't match, it throws `bad_output`.
- `ClaudeError` has `reason` (`ClaudeErrorReason`) and plain-words `message`. Routes answer `CLAUDE_ERRORS[reason]` with `details: { reason }`.
- `summarizeMeeting(db, { userId, workspaceId, notesPageId, agenda, notes, actionItems, attendees, transcript? }): Promise<MeetingSummary>` is for Meetings.
  - `MeetingSummary` is `{ summary, decisions: string[], actionItems: { text, owner?, due? }[] }`, checked with `meetingSummarySchema` from `@carehub/extras/claude`. `due` is YYYY-MM-DD; an owner or date Claude can't give properly is left out.
  - It's plain text: show it as text, never as HTML.
  - The person must be able to open the notes page, and the result goes to nobody who can't open the notes.
  - A long transcript is cut to fit; the agenda and notes always go in whole.
- `fillClaudeFields(db, { userId, databaseId, propertyId, rowIds })` fills a Claude field By hand for the Databases field type; see [Claude fields](#claude-fields-apiclaudefields).

The `documents` are `{ title, text }` pairs the **server** loaded by ID after the access check. A caller never passes text a client says came from a page; only the person's own selection comes from the client. The model and the largest `max_tokens` are set on the server. `maxTokens` can only lower that limit for one feature.

The numbers (core PR 1):

- `MAX_TOKENS` is 2,048, and a request holds at most `MAX_REQUEST_CHARS` (60,000) characters.
- Each person can send 30 requests in any 10 minutes.
- The monthly cap counts the calendar month in America/Denver.
- Every request sent is a row in `claude_usage`, failures included. Refusals before sending aren't.

The switches and the OK are what Admins save in Settings → Claude. Until the roles PR (#55) binds `canUseClaude` with `configureClaude`, nobody has `claude.use`, so nothing is sent. Until the page model (#49) binds `pages`, no page counts as open. Tests bind fakes the same way and put the old ones back with the function `configureClaude` returns.

## Settings → Claude (`/api/claude`)

Every route needs a signed-in person (401 otherwise). The shapes are in `@carehub/extras/claude/settings`.

- `GET /status` answers `ClaudeStatus`, `{ on: { writing_help, assistant, fields, meeting_summary, learning_help } }`: what the person can use in their workspace now (the key, the OK, the switch and `claude.use`). The web app asks every 5 seconds and hides what's off, so a feature switched off disappears within 5 seconds.
- `GET /settings` answers `ClaudeSettingsView`, for the workspace's Admins only (403 for anyone else):
  - `keySet` says whether the server has the key. The key itself never leaves the server.
  - `model`, `navApproved`, `switches`, and `chatRetentionDays`: null for kept until deleted (CL-D3), or 30, 90 or 365.
  - `usage`: `month` (YYYY-MM in America/Denver), `requests`, `monthlyRequests` and `byFeature`.
- `PUT /settings` takes `ClaudeSettingsUpdate`, also Admins only: any of `navApproved`, some or all `switches`, and `chatRetentionDays`. Anything else is 400 `invalid`.
  - Only what changed is saved, in one transaction.
  - Each change is one security log line, `{ event: 'claude.setting_changed', workspaceId, userId, key, value }`.
  - It answers with the new `ClaudeSettingsView`.

Stand-ins until other lanes land (core PR 3):

- **Workspace settings (accounts 1c):** they're kept in `claude_settings`, through `getWorkspaceSetting` and `setWorkspaceSetting` with the names 1c will use. A missing row means off. A later migration moves the rows across.
- **Members (#55):** until the roles PR calls `bindClaudeMembers(lookup)`, nobody is a member, so the status is all off and the settings answer 403.
- **Security log (S2):** until `logSecurityEvent` lands, the lines go to the app log under `security`.

## Claude fields (`/api/claude/fields`)

Databases owns the property type and its cell (phase 5). The shapes are in `@carehub/extras/claude/fields`.

- **Setup** (`claudeFieldSetupSchema`): `kind` (`summary`: up to 3 sentences; `key_points`: up to 5 points; `custom`: its own `instructions`, up to 1,000 characters), `uses` (property IDs), `usesPageContent` (up to 20,000 characters) and `fill` (`by_hand`, the default for a new field, or `auto`; CL-D4).
- **Inputs** (`claudeFieldInputProblem`):
  - Never relations, rollups, buttons, other Claude fields or formulas that read other rows (`unusable_input`).
  - A value reaches everyone who can see the field, so each input must be open to everyone who sees the row, or the field must be limited to people the input is also limited to (`hidden_input`).
  - Databases checks this when the setup is saved; every fill checks it again.
- **Who:** Fill needs `claude.use`, the switch, and Can edit on the row with permission to change the field. Anyone who can see the row sees the value.
- **What's sent:** the used properties' text as the person sees it and, if ticked, the row page's own text (never synced blocks or linked databases), cut to fit one request. A row with nothing to read fills empty without a request.
- **The value** (`claudeFieldValueSchema`): plain text up to 10,000 characters, `filledAt`, `filledFor` (null when it filled automatically) and `status`. When a request sent fails, the old text stays and `status` is `failed` ("Couldn't fill. Try again.").
- **`POST /fill`** `{ databaseId, propertyId, rowIds: [rowId] }` fills one row now and answers `{ status: 'filled', rowId, value }`. Refusals answer `CLAUDE_ERRORS` or `CLAUDE_FIELD_ERRORS` with `details: { reason }`.
- **Limits:** each database's Claude fields send at most 300 requests an hour (`claude_field_fills`, `database_hour`), on top of the monthly cap and each person's limit. Usage rows have the feature `fields`.
- **Next PR:** Fill all and Fill empty with the row-count confirm, filling 5 at a time in the background, and automatic fills.
- **Stand-in:** until Databases calls `bindClaudeFieldHost(host)` (`field`, `fillableRows`, `readRowText`, `saveFill`), no property is a Claude field, so nothing fills.

## Security rules (security reviewer, Oct 27)

- **One way out:**
  - Only `features/claude/server` calls Claude, with the built-in fetch, `redirect: 'error'`, a 30 s timeout, and the fixed URL `https://api.anthropic.com/v1/messages`.
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
  - Each workspace has a monthly cap (`CLAUDE_MONTHLY_REQUESTS`, default 3,000; CL-D2), and each person has a rate limit so one person can't use the whole cap.
  - Each request has a size cap.
  - 429 and 5xx are retried at most twice, with backoff; 4xx otherwise is never retried.
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
