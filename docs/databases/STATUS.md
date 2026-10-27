# Databases and Forms: status

Updated Oct 27, 2026, 05:05 UTC. Plan: [PLAN.md](PLAN.md). Storage and API: [decision 0200](../decisions/0200-databases-storage-and-api.md). The v2 specs win; lane details in [additions.md](additions.md).

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
- Screens: web shell part 1, the API client, layout contract, data hooks and test fixtures every layout builds on (#114).
- Security reviewer OK (Oct 27): forms anyone on the network can fill in, and anonymous uploads, both off by default per form, with the conditions in decision 0200.

## In progress

- Conditional colour (#90): one schema line so Default works as a rule colour, then merge; row colours in the view engine follow.
- Formula library with safe text patterns (security #13 part 2), which needs the security reviewer's OK for its one new package.
- Small follow-ups: buttons (a repeat that ends after a number of times; messages to groups, roles and Everyone) and Excel (skip empty rows above the header).
- Server (wave 2): schema, databases, properties, views and templates (branches from main, borrowing from #49 until it merges).
- Screens (wave 3): web shell part 2 (view tabs, states and row actions, moving to a fresh PR after a merge conflict), cells and property menus, and forms (fill screen, then the builder), all on the design kit with the API mocked until the server lands.

## Next

- Server: rows, query, jobs and forms (including public forms and anonymous uploads with the security conditions in decision 0200).
- Screens: toolbar and panels, table, board, list and gallery, calendar and timeline, chart and dashboard, row page, filters, formula editor and import dialogs.
- Breadth first: a working basic version of every feature on main before any polish, with colours, fonts and spacing from the design kit only.
