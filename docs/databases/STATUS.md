# Databases and Forms: status

Updated Oct 26, 2026. Plan: [PLAN.md](PLAN.md). Additions approved by Felipe: [additions.md](additions.md).

## Done

- Felipe's decisions recorded: formulas, rollups and column totals now; row-level access now; imports add rows only; Person notices yes; anonymous form answers yes (per form, off by default).
- Foundation of `packages/databases` written and tested locally: the shared contract (`types.ts`), dates and time zones, exact decimals, rich text, text comparison, row values, default schema, number and date text readers, result kinds.
- Agreed with Team tools: notices, calendar dates API, row and form events, live updates, background jobs, analytics.

## In progress

- Wave 1, pure logic (8 builders): values and type changes; filters and search; sorts, groups and order; totals and rollups; the formula engine; CSV; form logic; access, relations, templates and IDs.

## Next

- First pull request (foundation) as soon as the main lead's base app is on main, then one pull request per wave 1 part.
- Wave 1b: request schemas, chart data, the rest of the formula functions.
- Wave 2 (server) once pages, sharing and the database layer are on main; wave 3 (screens) after that.
