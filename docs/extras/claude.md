# Claude features

Spec: Claude features, checks CL-01 to CL-18 (kept in Notion, listed in [docs/plan/specs/README.md](../plan/specs/README.md)). Shared names: `@carehub/extras/claude`. Claude sends page content off the server, so the rules below apply to every Claude feature.

## Switches

The features are writing help in pages (`writing_help`), the assistant panel (`assistant`), Claude fields in databases (`fields`), meeting summaries (`meeting_summary`, called by Meetings) and Learning help (`learning_help`, called by Learning).

A request goes out only when all of these hold:

1. The server has `ANTHROPIC_API_KEY` (see [settings.md](settings.md)).
2. An Admin has ticked "Approved for this workspace" (`claude.workspaceApproved`) in Settings → Claude.
3. That feature's switch (`claude.<feature>`) is on. Every switch is off by default.
4. The person has `claude.use`. Guests never do.
5. The person can open every page and row whose text is sent.

Switch and workspace-approval changes go to the Security log (`logSecurityEvent`).

## Server API (`apps/server/src/features/claude/index.ts`)

- `isClaudeFeatureOn(db, workspaceId, feature): Promise<boolean>` checks the key, the approval and the switch.
- `askClaude(db, { workspaceId, userId, feature, system, instruction, documents?, selection?, maxTokens? }): Promise<{ text }>`
- `askClaudeJson(db, { ...the same, schema }): Promise<{ data }>` asks for JSON and checks it with the caller's zod schema. If it doesn't match, it throws `bad_output`.
- `ClaudeError` has `reason` (`ClaudeErrorReason`) and plain-words `message`. Routes answer `CLAUDE_ERRORS[reason]` with `details: { reason }`.
- `summarizeMeeting(db, { userId, workspaceId, notesPageId, agenda, notes, actionItems, attendees, transcript? })` is for Meetings. Its result goes to nobody who can't open the notes.
- `fillClaudeFields(db, { userId, databaseId, propertyId, rowIds })` is for the Databases field type, once it lands.

The numbers:

- `MAX_TOKENS` is 2,048, and a request holds at most `MAX_REQUEST_CHARS` (60,000) characters.
- Each person can send 30 requests in any 10 minutes.
- The monthly cap counts the calendar month in America/Denver.
- Every request sent is a row in `claude_usage`, failures included. Refusals before sending aren't.

Until Settings → Claude binds the real checks with `configureClaude`, every switch reads as off and nobody has `claude.use`, so nothing is sent. Tests bind fakes the same way and put the old ones back with the function `configureClaude` returns.

The `documents` are `{ title, text }` pairs the **server** loaded by ID after the access check. A caller never passes text a client says came from a page; only the person's own selection comes from the client. The model and the largest `max_tokens` are set on the server. `maxTokens` can only lower that limit for one feature.

## Security rules

- **One way out:**
  - Only `features/claude/server` calls Claude, with the built-in fetch, `redirect: 'error'`, a 30 s timeout, and the fixed URL `https://api.anthropic.com/v1/messages`.
  - `ANTHROPIC_BASE_URL` may point it at a local stub for tests, and only at loopback addresses.
  - There's no SDK and no new package.
- **The key:**
  - It comes only from server settings.
  - It never goes in the database, the web bundle, logs, errors or answers.
  - On a failure, log only the status and error type, never the request or Anthropic's response body.
  - A test sets a fictional key and checks it appears in no log, error or answer.
- **No tools:** Claude gets no tools, web access or actions.
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
