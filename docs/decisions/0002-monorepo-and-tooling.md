# 0002: Monorepo and tooling

- Status: proposed
- Date: 2026-10-26

## Context

Several builders work in parallel without network access. They need one install, one set of checks and fixed places to plug in features (AGENTS.md section 4).

## Decision

1. **npm workspaces** (`apps/*`, `packages/*`, `tests/*`), Node 24, ES modules. Internal packages export TypeScript source (`./src/index.ts`) and have no build step: Vite compiles them for the web app and esbuild bundles them into the server.
2. **One config each at the root:** `tsconfig.base.json` (strict, `moduleResolution: "bundler"`, plus `noUncheckedIndexedAccess` and `verbatimModuleSyntax`), an ESLint flat config (typescript-eslint everywhere, react-hooks and jsx-a11y on TSX; warnings fail the check) and Prettier.
3. **Server build:** esbuild writes `apps/server/dist/index.js`. It bundles `@carehub/*` and keeps every other package external, so the runtime needs production `node_modules`.
4. **Registration points:** a feature replaces only its own `// feature: <name>` line in `apps/server/src/app.ts` or `apps/web/src/routes.tsx` and imports lazily on that line (`app.register(import(...))`, route `lazy`), so parallel pull requests never meet in an import block.
5. **CI** follows 0006: `ci.yml` runs the quick checks in one job, runs every check even after an earlier one fails, and keeps one pull request comment with the result: the end of each failed log, or "passed" (agents can't read check runs with their token). `repo-bot.yml` regenerates `package-lock.json` on `main`.

## Consequences

- Until the bot commits the first lockfile, installs float within the caret ranges.
- `ci.yml` never builds, so a broken build first shows up in `e2e.yml` or `image.yml`.
- If `main` gets branch protection, the bot needs permission to push generated files.
