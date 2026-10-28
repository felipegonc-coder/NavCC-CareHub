# Databases and Forms: status

Updated Oct 27, 2026, 23:35 UTC. Plan: [PLAN.md](PLAN.md). Storage and API: [decision 0200](../decisions/0200-databases-storage-and-api.md). The v2 specs win; lane details in [additions.md](additions.md).

## Done

- Decisions recorded: formulas, rollups and column totals now; row-level access now; imports add rows only; Person notices yes; anonymous form answers yes (per form, off by default). Defaults in use until decided: Map view and Place later; one data source per database; forms anyone can fill in allowed per form, off by default.
- Merged logic in `packages/databases` (wave 1, all with tests):
  - Foundation and types (#6), safe links for security #12 part 1 and the v2 contract (#21), v2 type additions (#24).
  - Values, cell parsing and formatting, options, type changes (#19), and the v2 value rules: safe links, fixed time zones, reminders, file links, "+12 more" lists (#60).
  - Filters and search (#23); sorts, groups and manual order (#28); column totals and rollups (#25).
  - CSV import and export (#18); form logic: questions, show-if, checks, the gate (#20).
  - Access levels, row and property access, relations, templates and unique IDs (#54).
  - Request schemas for every request shape (#64); type changes into Formula, Rollup, ID and Button (#68); forms anyone can fill in can't limit responses per person (#80).
  - Formula engine with its limits for security #13 (#33); sub-items and dependencies (#103); button runs, Undo and repeating templates (#107); Excel import (#109); chart data in the design kit's colour names (#89).
  - View engine (#112): filters, search, sorts, groups, paging and totals for each viewer, with property access checked on every query and along formula and rollup chains (closes security #46).
  - Conditional colour in the design kit's colour names, Default included (#90); Excel import skips empty rows above the header (#152).
  - Caps in the Excel reader for security #212 (High) and #217 (Low): repeated text, cells and skipped rows, and damaged ZIP files refused (#286).
  - Row colours in the view engine's answer (#359); button messages to groups, roles and Everyone, and repeats that end after a number of times (#191); nothing turns into Formula, Rollup, ID, Button or Verification (#362); the Verification property and the wiki flag for the Knowledge base lane (#306); forms keep who mapped a question to a property and whether that person lost access (#591).
- Screens: web shell part 1, the API client, layout contract, data hooks and test fixtures (#114); the view shell with tabs, loading, empty and error states, toasts and row actions (#208); cells to show and edit every property type (#173); the table layout with columns, groups, editing, keyboard moves and totals (#195); the property header menu, type changes and deleted properties (#243); the table's column tools (#253); database pages, the database block and "/database" in the editor (#256); the table's row selection and bulk bar: Set property and Delete (#395); the form fill screen, signed in (#162); the form builder (#268); shell part 3a: the API client on lib/api, settings versions, options typed into cells, people for Person cells, duplicate rows (#406); the Edit property panel (#438); Verification in cells, for wiki databases only (#467); shell part 3b-1: live refetch, the panel registry and host (#530); the form pages at the design kit's page width (#531); the filter rules model and panel words (#485), the Sort panel (#487), date values for filter rules (#488), the other rule values (#489) and the advanced filter with nested groups (#490); type settings in Edit property: number display, date and time formats, person, ID prefix (#562); the Properties panel's rules and words (#565); the Group panel's rules and words (#595); shell part 3b-2: the toolbar, panels, the … menu and search (#535); the signed-out fill for forms anyone can fill in (#574, a fresh copy of the approved #532).
- Security reviewer OK (Oct 27): forms anyone on the network can fill in, and anonymous uploads, both off by default per form, with the conditions in decision 0200.

## In progress

Main is green. A pull request merges only on a green run, after its branch is updated from main. Accounts 1b (#55: workspaces, roles, members and guests) is on main, so the server pull requests swap their stand-ins for it when they're re-cut.

- Changes asked: the table's copy, paste, Undo and Redo (#542): one test has to wait for the queued writes.
- Drafts: the Filter and Sort panels on the shell's panel host (#552, replaces #493); the Properties panel (#566); the Group panel, part 2.
- Forms: formatted descriptions, the anonymous guard and the fill token (#581): read, and being re-cut on a fresh branch from main because it still carried #574's own commits. After it, the next forms part (#582), re-cut the same way.
- Formula library with safe text patterns (#193, security #13 part 2): approved and green; the main lead merges it. After it, the pattern work limit per call (#492), re-cut on a fresh branch from main; the security reviewer reads its last change.
- Server (wave 2), waiting on pages #49: schema, settings, properties with Undo for type changes, views, templates, the wiki flag, row access rules, create and duplicate for other lanes, and the Blue Pine Plumbing seed (#170, #181, #219, #242, #244, #249, #326, #348); rows, events, live updates and Person notices (#367); rows part 2 and the functions other lanes call (#436, draft); the query behind every view (#417, approved; the security reviewer's three Lows go in with its next push); chart data, picker rows and values as text (#561); CSV export (#550); the forms server: form links and the fill screen (#432), then responses with events and notices (#462, changes asked: membership from #55, row access for Relation answers); button presses, Undo and the run log (#529; the main lead merges it); date reminders (#564, changes asked: row and property access, membership from #55); CSV and Excel import (#528, draft). Being built: templates and repeats.

### Known gaps, with follow-ups

- Buttons: fill-ins and page cards need a package change. A step on a row in Trash should say "Couldn't finish step N: … is in Trash."
- Saving a Button property must check it with `validateButton` and refuse what it finds (400).
- Row pages always show Verification in wiki databases (with the row page).
- Forms anyone can fill in: a signed token for each fill, sent with uploads and with the answers, from the security review. The screens send it in #581's re-cut; the forms server checks it (#432, #462).
- Form uploads must send the CSRF token from `readCsrfToken` (#237) before the HTTPS deploy.

## Merged without CI

Every line read by the Databases lead, tests included, and checked against main. Package changes ran node:test, tsc (with noUnusedLocals) and Prettier locally on `packages/databases`. The PRs say which checks their builders ran. CI's runs since then passed every databases test: #406 and #438 in #530's first run (Oct 27, 19:53 UTC), and #467 in its run after the update from main (21:55 UTC).

| Pull request | Head merged                                | Squash commit | Checks                                                                                           |
| ------------ | ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------ |
| #191         | `b031a05195daff59be16affc7fa9f0bc1e210199` | `29cf7bc`     | Package: node:test, tsc, Prettier                                                                |
| #286         | `f8e75fec7d16d7e1f4e59d6ee3c60563993770b7` | `b1ab923`     | Package: node:test, tsc, Prettier                                                                |
| #359         | `7fb22f2b03179ab66f6d6f6464778ce4774a9dc6` | `38ab264`     | Package: node:test, tsc, Prettier                                                                |
| #362         | `75608e32bfa12142a9a5b51740ab862607a87b07` | `abd2110`     | Package: node:test, tsc, Prettier                                                                |
| #306         | `59741173f6754185a940003d6dc51950389f4594` | `9ab3ab4`     | Package: node:test, tsc, Prettier. Web: the two icon maps read by hand (not type-checked)        |
| #395         | `3ad718249001b26cadd93e556d8451e99acb56f6` | `bc0b56e`     | Builder: Prettier, tsc, no-one-off-styles, pure unit tests, Chromium smoke. Vitest/jsdom not run |
| #406         | `b3d2e099132502fe60bc3ab55164d6a08aa6aa8e` | `7f3fa6e`     | Builder: Prettier, strict tsc with stand-in types, node:test for api, cache and contract         |
| #438         | `f498f87f497c0d34690fd9c5561c042f59443e38` | `d6a2d50`     | Builder: strict tsc against main, the cells tests in a Chromium harness, Prettier                |
| #467         | `0c39ebad255403a050cf4b3973c2ea50e45f24a6` | `6234448`     | The builder's checks are listed in the PR. CI passed later (#530)                                |

## Next

- Server: public forms and anonymous uploads (with the security conditions in decisions 0200 and 0010), the public form cover, and file questions.
- Screens: board, list and gallery; calendar and timeline; chart and dashboard; the row page; the formula editor and import dialogs.
- Breadth first: a working basic version of every feature on main before any polish, with colours, fonts and spacing from the design kit only.
