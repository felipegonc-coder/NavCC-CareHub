# Databases and Forms: status

Updated Oct 27, 2026, 18:00 UTC. Plan: [PLAN.md](PLAN.md). Storage and API: [decision 0200](../decisions/0200-databases-storage-and-api.md). The v2 specs win; lane details in [additions.md](additions.md).

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
  - Row colours in the view engine's answer (#359); button messages to groups, roles and Everyone, and repeats that end after a number of times (#191); nothing turns into Formula, Rollup, ID, Button or Verification (#362); the Verification property and the wiki flag for the Knowledge base lane (#306).
- Screens: web shell part 1, the API client, layout contract, data hooks and test fixtures (#114); the view shell with tabs, loading, empty and error states, toasts and row actions (#208); cells to show and edit every property type (#173); the table layout with columns, groups, editing, keyboard moves and totals (#195); the property header menu, type changes and deleted properties (#243); the table's column tools (#253); database pages, the database block and "/database" in the editor (#256); the table's row selection and bulk bar: Set property and Delete (#395); the form fill screen, signed in (#162); the form builder (#268).
- Security reviewer OK (Oct 27): forms anyone on the network can fill in, and anonymous uploads, both off by default per form, with the conditions in decision 0200.

## In progress

CI hasn't run since about 12:10 UTC on Oct 27, when the Actions minutes ran out (decision 0006). Runs are expected back soon. Until they start, lane-only pull requests merge by hand after a full read, under the main lead's interim rule, and are listed below under "Merged without CI". Once runs start, each ready pull request runs its checks once, and merges need green checks again.

- Formula library with safe text patterns (#193; security #13 part 2): the security reviewer has approved its one new package. It changes the lockfile, so the main lead merges it by hand. After it, a follow-up measures the cost of each pattern call (program size × text read), with the security reviewer's conditions.
- Server (wave 2), waiting on pages #49: schema, settings, properties with Undo for type changes, views, templates, the wiki flag, row access rules, create and duplicate for other lanes, and the Blue Pine Plumbing seed (#170, #181, #219, #242, #244, #249, #326, #348); rows, events, live updates and Person notices (#367). Also open: rows part 2, the functions other lanes and the forms server call (#436, draft), and the forms server's first part (#432: form links, Change link and the fill screen), both after #367. Being built: the query behind every view; CSV and Excel import and export; buttons, date reminders, templates and repeats; form responses.
- Screens (wave 3): shell part 3a (#406: the API client on lib/api, settings versions, options typed into cells, people for Person cells, duplicate rows) has fixes asked for. The Edit property panel is in review (#438). Being built: the toolbar and panels; the filter, sort, group and property panels; type settings and select options; the table's next parts; the signed-out fill for public forms.

## Merged without CI

Every line read by the Databases lead, tests included, and checked against main. Package changes ran node:test, tsc (with noUnusedLocals) and Prettier locally on `packages/databases`. The PRs say which checks their builders ran. All of them get the first full run when the minutes are back.

| Pull request | Head merged                                | Squash commit | Checks                                                                                           |
| ------------ | ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------ |
| #191         | `b031a05195daff59be16affc7fa9f0bc1e210199` | `29cf7bc`     | Package: node:test, tsc, Prettier                                                                |
| #286         | `f8e75fec7d16d7e1f4e59d6ee3c60563993770b7` | `b1ab923`     | Package: node:test, tsc, Prettier                                                                |
| #359         | `7fb22f2b03179ab66f6d6f6464778ce4774a9dc6` | `38ab264`     | Package: node:test, tsc, Prettier                                                                |
| #362         | `75608e32bfa12142a9a5b51740ab862607a87b07` | `abd2110`     | Package: node:test, tsc, Prettier                                                                |
| #306         | `59741173f6754185a940003d6dc51950389f4594` | `9ab3ab4`     | Package: node:test, tsc, Prettier. Web: the two icon maps read by hand (not type-checked)        |
| #395         | `3ad718249001b26cadd93e556d8451e99acb56f6` | `bc0b56e`     | Builder: Prettier, tsc, no-one-off-styles, pure unit tests, Chromium smoke. Vitest/jsdom not run |

## Next

- Server: public forms and anonymous uploads (with the security conditions in decision 0200), and file questions.
- Screens: board, list and gallery; calendar and timeline; chart and dashboard; the row page; the formula editor and import dialogs.
- Breadth first: a working basic version of every feature on main before any polish, with colours, fonts and spacing from the design kit only.
