# Databases and Forms: status

Updated Oct 27, 2026, 01:40 UTC. Plan: [PLAN.md](PLAN.md). Storage and API: [decision 0200](../decisions/0200-databases-storage-and-api.md). The v2 specs win; lane details in [additions.md](additions.md).

## Done

- Felipe's decisions recorded: formulas, rollups and column totals now; row-level access now; imports add rows only; Person notices yes; anonymous form answers yes (per form, off by default). Defaults in use until he decides: Map view and Place later; one data source per database; forms anyone can fill in allowed per form, off by default.
- Merged logic in `packages/databases` (wave 1, all with tests):
  - Foundation and types (#6), safe links for security #12 part 1 and the v2 contract (#21), v2 type additions (#24).
  - Values, cell parsing and formatting, options, type changes (#19), and the v2 value rules: safe links, fixed time zones, reminders, file links, "+12 more" lists (#60).
  - Filters and search (#23); sorts, groups and manual order (#28); column totals and rollups (#25).
  - CSV import and export (#18); form logic: questions, show-if, checks, the gate (#20).
  - Access levels, row and property access, relations, templates and unique IDs (#54).

## In progress

- Formula engine (#33): final limits for security #13, then merge.
- Wave 1b: request schemas; chart data; sub-items and dependencies.
- Wave 1c: view engine (security #46 fixes); buttons and repeating templates; conditional color; Excel import and export.
- Small follow-ups: type menu offers Formula, Rollup, ID and Button; forms message for "anyone" forms.

## Next

- Formula library with safe patterns (security #13), after #33.
- Wave 2 (server, decision 0200) as pages, sharing, auth and test helpers land on main; wave 3 (screens, design kit tokens only) after the web skeleton and slots. Breadth first: a working basic version of every feature before polish.
