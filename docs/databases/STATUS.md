# Databases and Forms: status

Updated Oct 27, 2026, 15:40 UTC. Plan: [PLAN.md](PLAN.md). Storage and API: [decision 0200](../decisions/0200-databases-storage-and-api.md). The v2 specs win; lane details in [additions.md](additions.md).

## Done

- Felipe's decisions recorded: formulas, rollups and column totals now; row-level access now; imports add rows only; Person notices yes; anonymous form answers yes (per form, off by default). Defaults in use until he decides: Map view and Place later; one data source per database; forms anyone can fill in allowed per form, off by default.
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
- Screens: web shell part 1, the API client, layout contract, data hooks and test fixtures (#114); the view shell with tabs, loading, empty and error states, toasts and row actions (#208); cells to show and edit every property type (#173); the table layout with columns, groups, editing, keyboard moves and totals (#195); the property header menu, type changes and deleted properties (#243); the table's column tools (#253); database pages, the database block and "/database" in the editor (#256); the form fill screen, signed in (#162); the form builder (#268).
- Security reviewer OK (Oct 27): forms anyone on the network can fill in, and anonymous uploads, both off by default per form, with the conditions in decision 0200.

## In progress

CI has reported nothing since about 11:30 UTC on Oct 27 (Actions minutes; Felipe's call, through the main lead), so the PRs below wait for it.

- Security #212 (High) and #217 (Low): caps in the Excel reader on repeated text, cells and skipped rows, and damaged ZIP files refused (#286). The import job will also run the reader in a worker with memory and time limits.
- Formula library with safe text patterns (#193; security #13 part 2): the security reviewer approved its one new package; two small fixes, then it merges.
- Package follow-ups: row colours in the view engine (#359); buttons messaging groups, roles and Everyone, and repeats that end after a number of times (#191); nothing turns into Formula, Rollup, ID, Button or Verification (#362); the Verification property and wiki flag for the Knowledge base lane (#306).
- Server (wave 2), waiting on pages #49: schema, settings, properties with Undo for type changes, views, templates, the wiki flag, row access rules, create and duplicate for other lanes, and the Blue Pine Plumbing seed (#170, #181, #219, #242, #244, #249, #326, #348); rows, events, live updates and Person notices (#367). Starting now: CSV and Excel import and export; buttons, date reminders, templates and repeats. Next: the query behind every view (after the formula library), then the forms server.
- Screens (wave 3): the toolbar and panels, the table's next part (selection and the Calculate menu), property settings and select options, the filter, sort, group and property panels, and the signed-out fill for public forms.

## Next

- Server: forms (including public forms and anonymous uploads with the security conditions in decision 0200).
- Screens: board, list and gallery; calendar and timeline; chart and dashboard; the row page; the formula editor and import dialogs.
- Breadth first: a working basic version of every feature on main before any polish, with colours, fonts and spacing from the design kit only.
