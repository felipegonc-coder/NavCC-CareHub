# Databases and Forms: status

Updated Oct 27, 2026, 03:20 UTC. Plan: [PLAN.md](PLAN.md). Storage and API: [decision 0200](../decisions/0200-databases-storage-and-api.md). The v2 specs win; lane details in [additions.md](additions.md).

## Done

- Felipe's decisions recorded: formulas, rollups and column totals now; row-level access now; imports add rows only; Person notices yes; anonymous form answers yes (per form, off by default). Defaults in use until he decides: Map view and Place later; one data source per database; forms anyone can fill in allowed per form, off by default.
- Merged logic in `packages/databases` (wave 1, all with tests):
  - Foundation and types (#6), safe links for security #12 part 1 and the v2 contract (#21), v2 type additions (#24).
  - Values, cell parsing and formatting, options, type changes (#19), and the v2 value rules: safe links, fixed time zones, reminders, file links, "+12 more" lists (#60).
  - Filters and search (#23); sorts, groups and manual order (#28); column totals and rollups (#25).
  - CSV import and export (#18); form logic: questions, show-if, checks, the gate (#20).
  - Access levels, row and property access, relations, templates and unique IDs (#54).
  - Request schemas for every request shape (#64); type changes into Formula, Rollup, ID and Button (#68); forms anyone can fill in can't limit responses per person (#80).
- Security reviewer OK (Oct 27): forms anyone on the network can fill in, and anonymous uploads, both off by default per form, with the conditions in decision 0200.

## In progress

- Formula engine (#33): final limits for security #13, then merge.
- Logic: chart data (#89) and conditional colour (#90), both moving their colours to the design kit's names; sub-items and dependencies; view engine (security #46); buttons and repeating templates; Excel import and export.
- Server (wave 2): schema, databases, properties, views and templates (first builder started; branches from main, borrowing from #49 until it merges).
- Screens (wave 3): the database shell and shared web pieces, cells and property menus, and forms (fill screen, then the builder), all on the design kit with the API mocked until the server lands.

## Next

- Formula library with safe patterns (security #13), after #33.
- Server: rows, query, jobs and forms; screens: table, board, list and gallery, calendar and timeline, chart, row page, filters, formula editor and import dialogs.
- Wave 2 (server, decision 0200) as pages, sharing, auth and test helpers land on main; wave 3 (screens, design kit tokens only) after the web skeleton and slots. Breadth first: a working basic version of every feature before polish.
