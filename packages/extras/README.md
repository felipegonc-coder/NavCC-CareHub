# @carehub/extras

Pure TypeScript shared by the web app and the server for the Extras lane: search, history,
templates, import and export, the knowledge base and Claude. No React, no Node APIs, no app code.

Import a feature's entry point (`@carehub/extras/claude`) or a file inside it
(`@carehub/extras/claude/prompts`). Each builder adds files only under its own `src/<feature>/`, so
nobody edits a shared index. Lane rules, contracts and folders: [docs/extras/README.md](../../docs/extras/README.md).
