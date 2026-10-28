# Builder rules and tech (for the agents)

_Copied from the Notion plan (the source of truth) on 2026-10-26. If they differ, Notion wins._

> 🧱 Rules for building Care Hub.

## Clean-room rules

1. Build only from the plan pages, the Learning PRD and tracker, and the answered decisions.
2. Never open, copy or paste code from CareHub, CareHub-Web, CareHub-Cloud, AppFlowy or any GPL or AGPL project, and never ask for it. If you remember code from them, write your own anyway.
3. Today's Care Hub screens may be used only to understand behavior and look. Build them your own way.
4. Every pull request says: "Written from the spec. No code copied from AppFlowy or the old Care Hub."
5. No real company or customer data, no secrets in the repository, and Claude features off by default.
6. Never read earlier agent sessions or their files. They contain old Care Hub code.

## Licenses

- Allowed in anything we ship: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD and the PostgreSQL License. MPL-2.0 only for unmodified test tools.
- Blocked: GPL, LGPL, AGPL, SSPL, BUSL, Elastic, Commons Clause, and paid or unknown licenses. Also not allowed: MinIO, Tiptap Pro extensions, FullCalendar Premium and paid UI kits.
- A license check runs on every pull request and fails on anything blocked. `THIRD_PARTY_NOTICES.md` is generated automatically.
- The repository's LICENSE reserves all rights.

## Tech choices

| Part | Choice | License |
| --- | --- | --- |
| Language | TypeScript (strict) everywhere | Apache-2.0 |
| Web app | React, Vite, React Router, TanStack Query | MIT |
| Look | Tailwind CSS and Radix UI primitives (shadcn/ui style, our own theme) | MIT |
| Editor | Tiptap open-source core on ProseMirror | MIT |
| Live co-editing | Yjs and Hocuspocus | MIT |
| Server | Node 24, Fastify, zod | MIT |
| Database and search | PostgreSQL with Drizzle ORM; Postgres full-text search | PostgreSQL / Apache-2.0 |
| Passwords | Argon2id (@node-rs/argon2) | MIT |
| Files | Stored on the server's disk, served by the server | — |
| Drag and drop, charts, icons, dates | dnd-kit, Recharts, Lucide, date-fns | MIT / ISC |
| Calendars | node-ical, tsdav (iCloud CalDAV), googleapis | Apache-2.0 / MIT |
| Transcription | Transformers.js with the Whisper model, in the browser | Apache-2.0 / MIT |
| Claude | Anthropic SDK | MIT |
| Tests | Vitest, Playwright, axe-core | MIT / Apache-2.0 / MPL-2.0 |
| Running it | Docker Compose on Ubuntu, Caddy for HTTPS, automatic updates | Apache-2.0 |

## Repository

- This repository: `apps/web`, `apps/server`, `packages/shared`, `deploy` (Docker Compose, Caddy, backups), `docs/plan` (these pages as Markdown) and `docs/decisions`.
- One Docker image for the server, which also serves the web app. GitHub Actions builds it into a container package, and the server pulls new versions on its own.

## Every pull request

- Small and focused, with tests (Vitest for logic, Playwright for screens), type check, lint, license check and an accessibility check (axe) on the screens it touches.
- Screenshots in light and dark mode, on a computer and a phone.
- Updates its row in the Care Hub rebuild tracker.
- Done means: matches the spec, works with the keyboard and screen readers, works on phones, permissions are checked on the server, no secrets, nothing copied.

## Security basics

- Every request checks the person's permissions on the server. Hiding a button is not security.
- Sessions in secure HttpOnly cookies, CSRF protection and rate limits on sign-in.
- Calendar passwords and tokens are encrypted at rest. Uploads are checked for type and size. Embeds only from an allow-list.
- Nightly backups are tested by restoring them.

## Data formats

- Pages are stored as Yjs documents, with a Markdown copy for search, export and backups.
- Courses keep our own Learning course format (lessons, blocks and questions as JSON), so old courses import cleanly.
