# 0400: The Extras lane

Status: accepted (main lead and Extras lead), Oct 27, 2026. Builds on 0007 (shared contracts); the main lead adds the lane to 0007.

## Context

Search, history, templates, import and export were core features nobody had started. The knowledge base extras had no owner, and the Claude features were assigned to Team tools but not started. Felipe's bar for Friday, Oct 30, is "everything Notion has, but better", so these features get their own lane and lead.

## Decision

- **Ownership:**
  - **Search**, including the Ctrl+K window: the shell binds no shortcut, and the window lists `slots.commands` as Actions.
  - **History:** versions, Updates and Archive.
  - **Templates and buttons:** the gallery, Save as template, the starter Customer Care templates, template variables and the "/button" block.
  - **Import and export,** including Print and PDF and Markdown export.
  - **Knowledge base extras,** built on the Databases lane's wiki kind and Verification property.
  - **Claude features,** moved from Team tools and off by default.
- **Not ours:**
  - Core keeps Trash and its nightly purge, and adds archiving's page columns and functions in pages PR 2.
  - Databases keeps database templates, the Button property and the Claude field type.
  - Import and export uses S4's Markdown functions (#198, #200) and Databases' CSV functions.
- **Folders:**
  - `packages/extras` (`@carehub/extras`, subpath exports)
  - `apps/{server,web}/src/features/{search,history,templates,import-export,knowledge,claude}/`
  - `packages/editor/src/lanes/extras.ts` and `lanes/claude.ts`
  - `tests/e2e/extras/` and `docs/extras/`
- **Names:**
  - Migrations: `*_<feature>_*.sql`
  - Tables: `search_`, `history_`, `tpl_`, `ie_`, `kb_`, `claude_`
  - Branches: `feat/extras-*`
  - Decisions: 0400–0499
  - The Extras lead reviews and squash-merges PRs that stay inside these folders.
- **Registration:** this decision's PR adds every Extras line to `app.ts`, `seed.ts`, `routes.tsx`, `slots.ts`, `tests/e2e/screens.ts` and `lanes/index.ts`, pointing at empty modules, plus the `@carehub/extras` dependency lines. It also adds two slots: `overlays` (`{ id, Component }`, rendered once by the app shell) and `pageBanners` (`{ id, order, Component<{ page }> }`, rendered by the page view above the title).
- **Contracts:** we build against the 0007 names, with stand-ins that deny by default (see [docs/extras/README.md](../extras/README.md)). The Security log stand-in is `logSecurityEvent(tx, { workspaceId, actorId, action, targetId?, details? })` until core builds the real one.
- **Dependencies:** none for Friday (see [docs/extras/import-export.md](../extras/import-export.md#safety)). Claude goes through the built-in fetch, under the security reviewer's rules in [docs/extras/claude.md](../extras/claude.md).

## Consequences

- Other lanes call our functions (`registerSearchText`, `listSearchTerms`, `askClaude`, `summarizeMeeting`) and never touch our tables.
- Learning help and meeting summaries share one Claude client, key, monthly cap, usage log and Admin page.
