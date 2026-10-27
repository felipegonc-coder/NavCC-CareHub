# Databases and Forms: status

Updated Oct 27, 2026, 09:10 UTC. Plan: [PLAN.md](PLAN.md). Storage and API: [decision 0200](../decisions/0200-databases-storage-and-api.md). The v2 specs win; lane details in [additions.md](additions.md).

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
- Screens: web shell part 1, the API client, layout contract, data hooks and test fixtures (#114); the view shell with tabs, loading, empty and error states, toasts and row actions (#208); cells to show and edit every property type (#173); the form fill screen, signed in (#162).
- Security reviewer OK (Oct 27): forms anyone on the network can fill in, and anonymous uploads, both off by default per form, with the conditions in decision 0200.

## In progress

- Security #212 (High): the Excel reader gets caps on repeated text before any route uses it; the import job will also run it in a worker with memory and time limits.
- Formula library with safe text patterns (#193; security #13 part 2), waiting on the security reviewer's OK for its one new package.
- Package follow-ups: row colours in the view engine; buttons messaging groups, roles and Everyone and repeats that end after a number of times (#191); type changes match the spec (nothing turns into Formula, Rollup, ID, Button or Verification); the Verification property and wiki flag for the Knowledge base lane.
- Server (wave 2): schema and settings (#170, #181; drafts until pages #49 merges), then views and templates; rows, events, live updates and the functions other lanes call (calendar layers, automations, search, templates, imports).
- Screens (wave 3): database pages and the "/database" block in the app, the toolbar and panels, the table (#195), the property menu and settings, and the form builder, then the signed-out fill for public forms.

## Next

- Server: query (the view engine behind the routes, computed values, view events), jobs (CSV and Excel import and export, buttons, repeating templates, reminders) and forms (including public forms and anonymous uploads with the security conditions in decision 0200).
- Screens: board, list and gallery; calendar and timeline; chart and dashboard; row page; filters; formula editor and import dialogs.
- Breadth first: a working basic version of every feature on main before any polish, with colours, fonts and spacing from the design kit only.
