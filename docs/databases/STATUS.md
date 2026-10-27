# Databases and Forms: status

Updated Oct 27, 2026, 00:10 UTC. Plan: [PLAN.md](PLAN.md). The v2 specs win; lane details in [additions.md](additions.md).

## Done

- Felipe's decisions recorded: formulas, rollups and column totals now; row-level access now; imports add rows only; Person notices yes; anonymous form answers yes (per form, off by default). Defaults in use until he decides: Map view and Place later; one data source per database; forms anyone can fill in allowed per form, off by default.
- Merged: the foundation of `packages/databases` (#6) and CSV import and export logic (#18).
- Approved: value checks, cell parsing and formatting, options and type changes (#19), merging after #21.

## In progress

- #21: safe links (security #12, first part) and the v2 contract additions.
- Wave 1 builders: filters and search; sorts and groups; totals and rollups; the formula engine; form logic; access, relations and templates; values v2 follow-up.
- Wave 1b builders: request schemas; chart data; sub-items and dependencies.

## Next

- Formula library with safe patterns (#13), view engine, conditional color, buttons and repeating templates, Excel import.
- Wave 2 (server) as the main lead's pages, sharing and test helpers land on main; wave 3 (screens) after that.
