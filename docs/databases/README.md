# Databases and Forms lane: guide for builders

Lead: the Databases and Forms lead (reviews and squash-merges every `feat/db-*` and `feat/forms-*` pull request).
Specs: [Databases](https://app.notion.com/p/fe27d484cabc4a74ae11028f8d43465f), [Forms](https://app.notion.com/p/6640881fdf6d41c390c8576c2c971b1d) and the lane's [additions](additions.md) (the decisions of Oct 26 and Notion-parity items). Wave plan and parts: [PLAN.md](PLAN.md). Status: [STATUS.md](STATUS.md).

## 1. Clean room (most important)

1. Build only from the specs above, `docs/plan/`, `AGENTS.md`, and what the lead tells you.
2. Never open, search for, copy or paste code from AppFlowy, CareHub, CareHub-Web, CareHub-Cloud or any GPL or AGPL project: not on GitHub, not on the web, not from memory. If you remember code from them, write your own anyway.
3. Never read earlier agent sessions or their files. Don't search for them or open them.
4. Every pull request description contains this exact line:
   `Written from the spec. No code copied from AppFlowy or the old Care Hub.`
5. Fictional people and businesses only (for example Avery Lin, Jordan Park, Blue Pine Plumbing). No secrets. Claude features stay off.

## 2. Folders this lane owns

| Folder                                                                 | What                                                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/databases` (`@carehub/databases`)                            | Pure logic shared by web and server: values, filters, sorts, groups, totals, formulas, rollups, CSV, form logic, row access |
| `apps/server/src/features/databases`, `apps/server/src/features/forms` | API, permissions, jobs                                                                                                      |
| `apps/web/src/features/databases`, `apps/web/src/features/forms`       | Screens                                                                                                                     |
| `tests/e2e/databases`, `tests/e2e/forms`                               | Browser tests                                                                                                               |
| `apps/server/migrations/*_databases_*.sql`, `*_forms_*.sql`            | Migrations                                                                                                                  |
| `docs/databases/`                                                      | This guide, the plan, status                                                                                                |

Anything else (root files, CI, design kit, pages, editor, sign-in) belongs to the main lead: ask the lane lead, never edit it yourself.

## 3. The contract (read before coding)

`packages/databases/src/types.ts` defines every stored shape: property configs, stored values, rows, views, filters, sorts, groups, forms and row-access rules. The foundation modules are already written and tested:

| Module        | Gives you                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | All shapes and limits (`LIMITS`)                                                                                                                            |
| `dates.ts`    | Calendar dates, time zones (`todayIn`, `zonedToInstant`, `instantToCalendarDate`), relative ranges (`resolveDateRef`, `resolveDateWindow`), date formatting |
| `decimal.ts`  | Exact decimals for Number: canonical strings, BigInt arithmetic, `formatDecimal`                                                                            |
| `richtext.ts` | Rich text helpers and `sanitizeRichText` for untrusted input                                                                                                |
| `text.ts`     | `compareText` (ignores case and accents, natural numbers), `foldText`, `textIncludes`                                                                       |
| `row.ts`      | `readValue(row, property, ctx)`: the value of any property, automatic ones included                                                                         |
| `schema.ts`   | Default configs, `newDatabaseSchema`, `defaultView`, type labels                                                                                            |
| `ids.ts`      | `newId()`                                                                                                                                                   |

Rules:

- **Don't edit the foundation files** (the ones above and `index.ts`). If you need a change, say exactly what and why in your report; the lead batches contract changes.
- Your module is imported by subpath, for example `@carehub/databases/filter`, so nobody edits a shared index. Inside the package, import with relative paths and no extension (`./dates`).
- Pure functions only: no I/O, no `Date.now()` or `new Date()` without an argument (use `viewer.now`), no globals, no randomness except `newId()`.
- Empty is always absent or `null`, never `""` or `[]`.
- Numbers are exact decimal strings; use `decimal.ts`, never floating point, for stored numbers and totals. Formulas use JavaScript numbers.
- Dates: compare `CalendarDate`s as strings; turn instants into the viewer's day with `dates.ts`.
- Write the doc comment for every export in plain words. Keep files under about 400 lines; split by topic.

## 4. Working without network (local toolkit)

Agent computers have no internet. This computer has a local toolkit (never committed):

```sh
# unit tests (Vitest-style API on node:test): describe, it, expect, vi.fn, it.each
/data/toolkit/bin/test.sh packages/databases/src/filter.test.ts
# strict type check (TypeScript 7, stricter than the repo, so passing here passes CI)
/data/toolkit/bin/typecheck.sh packages/databases/src/filter.ts packages/databases/src/filter.test.ts
```

Paths are relative to `/data/carehub`, the shared local tree. Several builders work in it at once: **only create or edit your own files**. Run the type check on your own files (imports are followed). Tests import from `vitest` exactly as in the repo.

React, zod 4, esbuild and Playwright with Chrome are under `/vercel/sandbox/node_modules` (already linked in `/data/carehub/node_modules`), but there are no React types, Vite or Tailwind, so screens can only be type-checked and tested in CI.

## 5. Pull requests

- One part per builder, one branch (`feat/db-<part>` or `feat/forms-<part>`), one pull request into `main`. Don't push until the lead says `main` is ready.
- Aim for under about 600 changed lines of non-test code. If your part is bigger, say so; the lead splits it.
- Push complete, self-reviewed work in as few commits as possible (one `push_files` call with `arguments_file_path`). The GitHub account is shared: no polling loops; wait at least 3 minutes between CI checks; back off on rate-limit errors.
- Description template:

```
## What
<one paragraph>

## Spec checks covered
DB-xx, ... (or "logic for DB-xx; screens come later")

## Tests
Local: /data/toolkit/bin/test.sh → N passed. Type check: ok.
CI: <link or "pending">

## Open questions
<or "None">

Written from the spec. No code copied from AppFlowy or the old Care Hub.
```

- Done means: matches the spec, tests cover the acceptance checks you touch, the quick checks are green, permissions are checked on the server, keyboard and screen readers work (screens), no secrets, nothing copied.
