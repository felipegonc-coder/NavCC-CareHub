# Databases and Forms: additions

Approved by Felipe on Oct 26, 2026. Updated Oct 27 for the v2 specs.

**The specs win.** The v2 specs written on Oct 26 cover most of this page and win wherever they differ: [Databases](https://app.notion.com/p/fe27d484cabc4a74ae11028f8d43465f), [Formulas](https://app.notion.com/p/79b23fda5f624034a964c8df4ca2ff86), [Forms](https://app.notion.com/p/6640881fdf6d41c390c8576c2c971b1d), [Roles and permissions](https://app.notion.com/p/d2e6352004d64a9b93a0b3ee29ee4259) and [Templates and buttons](https://app.notion.com/p/53b55b188e7c49e19a3d43e383e01eb6). This page keeps only lane details the specs don't give. Shapes are in `packages/databases/src/types.ts`.

## 1. Felipe's decisions

| Decision                                                         | Answer                                                | What it means                                                                                                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DB-D1 Formulas, rollups, column totals                           | Now                                                   | Sections 2–4                                                                                                                          |
| DB-D2 Row-level access                                           | Now                                                   | Section 7                                                                                                                             |
| DB-D3 Import updates rows with the same Name                     | No, add only                                          | As the spec says                                                                                                                      |
| DB-D4 Notices when added to a Person property                    | Yes                                                   | On for new Person properties. A bulk change sends one notice per person; imports send none; only people who can open the row are told |
| FM-D1 Anonymous form responses                                   | Yes                                                   | A setting per form, off by default. Section 8                                                                                         |
| DB-D5 Map view and Place property                                | Later (default, waiting for Felipe)                   | Not in the type or layout menus                                                                                                       |
| DB-D6 Several data sources in one database                       | Later (default, waiting for Felipe)                   | One table of rows per database                                                                                                        |
| FM-D2 Forms anyone on the network can fill in without signing in | Allowed per form, off by default (waiting for Felipe) | Always anonymous; no Person or Relation questions; 30 responses a minute per form                                                     |

## 2. Formulas

**The [Formulas spec](https://app.notion.com/p/79b23fda5f624034a964c8df4ca2ff86) replaces this section** for syntax, types, functions, messages, limits and loops. Kept here: storage, and how patterns run safely.

**Patterns (security #13).** `test`, `match`, `replace` and `replaceAll` never run JavaScript `RegExp` on a typed pattern. They use the RE2 engine (`re2js`, linear time), patterns up to 200 characters, text up to 10,000 characters, inside the 50 ms per-row limit ("⚠ Pattern too slow").

**Links (security #12).** `link()` and every URL value pass `isSafeWebLink` (http and https only); anything else shows as plain text.

**Editing.** Formula property → "Edit formula" opens the editor: an expression box (monospace, line breaks and `/* comments */` allowed), a live result for the view's first row ("No rows to preview" if none), the error under the box with its position, a list of properties (click inserts `prop("Name")`) and the functions grouped by kind, each with a one-line description and an example. Done (or Ctrl+Enter) saves; Esc cancels. Done is disabled while the formula has an error. Needs Can edit and Lock structure off.

**Storage.** Stored with ids, `prop("<property id>")`; the editor shows names, so renaming a property never breaks a formula. If a referenced property is deleted, the formula shows `Property "Score" was deleted.` until it's fixed or the property is restored. Up to 10,000 characters.

**Values.** number, text, checkbox (true or false), date, person, page (a row) and lists of these; anything can be empty. What each property gives a formula:

| Property                        | In a formula                                            |
| ------------------------------- | ------------------------------------------------------- |
| Name, Text, Link, Email, Phone  | text                                                    |
| Number                          | number                                                  |
| Select, Status                  | text (the option name)                                  |
| Multi-select                    | list of text                                            |
| Date, Created time, Edited time | date                                                    |
| Checkbox                        | checkbox                                                |
| Person                          | list of person; Created by and Edited by are one person |
| Relation                        | list of page (only rows the viewer can open)            |
| Files                           | list of text (file names)                               |
| Checklist                       | number: the share done, 0 to 1                          |
| ID                              | text with a prefix ("QA-12"), otherwise number          |
| Formula, Rollup                 | its result                                              |

**Syntax** (Notion formulas):

- Literals: numbers (`1`, `2.5`, `1e3`), text in double quotes (`\"`, `\\` and `\n` escapes), `true`, `false`, lists `[1, 2, 3]`.
- Operators, tightest first: `( )`; `.method()`; unary `-`, `not`, `!`; `^` (right to left); `*`, `/`, `%`; `+`, `-`; `>`, `>=`, `<`, `<=`; `==`, `!=`; `and`, `&&`; `or`, `||`; `? :`.
- `+` adds numbers or joins text (a number joined with text becomes text). `==` compares values of the same kind; text comparison is exact.
- `x.f(a)` is the same as `f(x, a)`. `page.prop("Name")` reads a related row's property.
- In list functions, `current` is the item and `index` its position (0-based); they refer to the closest enclosing function.
- `let(name, value, expression)` and `lets(a, 1, b, 2, expression)` name values.

**Functions.**

| Kind   | Functions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logic  | `if`, `ifs`, `empty` (one argument: is it empty, where "", 0, false and [] count as empty; no argument: an empty value), `not`, `and`, `or`, `equal`, `unequal`                                                                                                                                                                                                                                                                                                                                |
| Text   | `length`, `substring(text, start, end?)`, `contains`, `test(text, pattern)`, `match(text, pattern)` (list), `replace(text, pattern, with)`, `replaceAll`, `lower`, `upper`, `trim`, `repeat`, `split`, `join(list, separator)`, `format(value)`, `toNumber`, `link(label, url)`, `style(text, styles…)` (b, i, u, s, c and the text colors, plus `_background` colors), `unstyle(text, styles?)`                                                                                               |
| Math   | `add`, `subtract`, `multiply`, `divide`, `mod`, `pow`, `abs`, `ceil`, `floor`, `round(x, places?)` (places may be negative: `round(1234, -2)` is 1200), `sqrt`, `cbrt`, `exp`, `ln`, `log10`, `log2`, `sign`, `min`, `max`, `sum`, `mean`, `median` (numbers or lists), `pi`, `e`                                                                                                                                                                                                              |
| Dates  | `now`, `today`, `minute`, `hour`, `day` (1 Monday … 7 Sunday), `date` (day of the month), `week` (ISO week 1–53), `month` (1–12), `year`, `dateAdd(date, amount, unit)`, `dateSubtract`, `dateBetween(a, b, unit)` (a − b in whole units, toward zero), `dateRange(start, end)`, `dateStart`, `dateEnd`, `timestamp` (milliseconds), `fromTimestamp`, `formatDate(date, pattern)`, `parseDate(ISO text)`. Units: years, quarters, months, weeks, days, hours, minutes (singular also accepted) |
| People | `name`, `email`, `id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Lists  | `at` (negative counts from the end), `first`, `last`, `slice`, `concat` (lists only), `sort`, `reverse`, `unique`, `includes`, `find`, `findIndex` (−1 if none), `filter`, `some`, `every`, `map`, `flat` (one level), `length`, `join`                                                                                                                                                                                                                                                        |
| Pages  | `id()` (this row), `id(page)`, `prop`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Rules.**

- Numbers inside formulas are ordinary floating-point numbers. Results show with the formula's number display (format, decimals, show as). Dividing by zero gives an empty value.
- Dates without a time stay calendar dates; `today()` is the viewer's date and `now()` an exact moment. Adding hours or minutes to a calendar date gives a time from the viewer's midnight. Comparing a calendar date with a time uses the viewer's midnight.
- `formatDate` patterns: YYYY, YY, Q, M, MM, MMM, MMMM, D, DD, Do, d, ddd, dddd, H, HH, h, hh, m, mm, A, a. Text in `[brackets]` or after `\` is kept as is.
- `format(value)`: numbers without grouping ("1234.5"), dates in the full format, lists joined with ", ", checkboxes "true" or "false", people's names, pages' titles.
- Types are checked when saving: for example `prop("Score") + true` → "+ needs numbers or text". Both branches of `if` must be the same kind (an empty value fits any). The result kind is saved with the formula (`resultKind`); filters, sorts, groups and totals use it.
- Patterns (`test`, `match`, `replace`, `replaceAll`) use JavaScript regular expressions without slashes, up to 200 characters. Backreferences and nested repeats such as `(a+)+` are refused ("This pattern is too complex."). They read at most the first 10,000 characters.
- A formula can't depend on itself, directly or through other formulas and rollups, in any database: "This formula refers to itself through 'Total'." Chains longer than 5 formulas and rollups are refused.
- Limits per row: 100,000 steps, lists of 10,000 items, nesting 100 deep. Past them the cell shows "This formula is too complex."
- A runtime error (a bad date, for example) shows in that cell only, with the message on hover.
- Formulas are computed when rows are read, never stored. Results can differ per viewer: their time zone, and only rows they can open.

**Filters and sorts** follow the result kind: text → text filters; number → number filters; checkbox → is ticked and is not ticked; date → date filters; person → person filters; page → relation filters; lists → contains, does not contain (matching any item's text), is empty, is not empty. Lists sort by their first item.

## 3. Rollups

- Settings: **Relation** (a relation property of this database), **Property** (any property of the related database, formulas and rollups included), **Calculate**.
- Calculations: show original, show unique values, count all, count values, count unique values, count empty, count not empty, percent empty, percent not empty; for numbers: sum, average, median, min, max, range; for dates: earliest date, latest date, date range; for checkboxes: checked, unchecked, percent checked, percent unchecked.
- "Count all" counts related rows; "count values" counts non-empty values (each value of a multi-value property counts); percent results show as percent.
- Results: lists for show original and show unique (shown like the property); dates for earliest and latest; date range gives the earliest start → the latest end; everything else is a number, shown with the rollup's number display (it starts as the target's number format).
- Only related rows the viewer can open are counted. Their titles and values never reach the browser.
- Loops: "This would make a loop." Chains: as in the Formulas spec (10 deep).
- When some related rows can't be opened, the result shows a hover note: "Based on 2 of 3 rows you can open".
- Filters and sorts follow the result kind, as for formulas.

## 4. Column totals

- Table footer: one per column, "Calculate ▾" on hover when empty. Grouped tables show a footer per group.
- Board, gallery and list group headers show the count (as in the spec); board column headers can show another calculation; the timeline's table has its own footer.
- Date labels: "Earliest", "Latest", "Date range"; rollup date labels: "Earliest date", "Latest date".
- Options: none, count all, count values, count unique values, count empty, count not empty, percent empty, percent not empty; numbers: sum, average, median, min, max, range; dates: earliest, latest, date range; checkboxes: checked, unchecked, percent checked, percent unchecked. Name offers the counts only.
- Totals cover every row that matches the view's filters and search (not just the loaded ones) that the viewer can open. The server computes them with the query; they refresh with live updates.
- Labels: "Sum 12,340" in the property's number format; percents with up to one decimal ("25%", "33.3%"); date range "Oct 1 → Oct 26, 2026".
- Saved per view (`View.calculations`). Changing them needs Can edit and Lock structure off; they aren't part of "Changed for you only".

## 5. Timeline view

- A table on the left (optional, its own columns) and bars on a time axis on the right.
- **Show by**: one date property (bars go start → end) or separate start and end date properties. A start with no end is a one-day bar. Rows without a start are under "No date" (a button with a count that opens a list); drag one onto the timeline to give it dates.
- **Scale**: Hours, Day, Week, Bi-week, Month (default), Quarter, Year. "Today" scrolls to today; a line marks today; the arrows move one screen.
- Drag a bar to move it (keeps its length); drag an end to change only that end. Steps: 15 minutes (Hours), otherwise 1 day. Created and edited times show but don't drag.
- Bars show the title and the view's visible properties. Filters, sorts and grouping work as in the table. Clicking a bar opens the row.
- Keyboard: Tab to a bar; ← and → move it one step; Shift+← and Shift+→ change its end; Enter opens.
- Phone: the table part only, with the dates as columns.
- Dependencies (arrows between rows) follow the Databases spec (Blocked by and Blocking; Shift or Don't shift).

## 6. Row templates

- "New ▾" lists the database's templates, "Empty" and "+ New template". Each template's "…" menu: Edit, Duplicate, Delete, Set as default (This view, or All views).
- A template is a page with a name, icon, cover, preset property values and content. Editing it opens it like a row, with the banner "You're editing a template in [database]."
- New, "+ New", a board column's New, a calendar day and the timeline use the view's default template, otherwise the database's, otherwise an empty row. The column, day and filter values are applied on top of the template's.
- Dynamic presets: dates can be "Today" or "Now" and people can be "Me", resolved for the person creating the row in their time zone.
- Content and values are copied when the row is made; editing a template later doesn't change existing rows.
- Templates never show up as rows: not in views, search, counts, totals, rollups, charts, relation pickers, exports, the calendar API or forms. Form responses and CSV imports don't use templates.
- Managing templates needs Can edit and Lock structure off; using them needs Can edit content. Up to 50 per database. Duplicating a database copies its templates.
- Repeating templates, "Today + 3 days", "This page", and applying a template to an existing row: the [Templates and buttons spec](https://app.notion.com/p/53b55b188e7c49e19a3d43e383e01eb6).

## 7. Row-level access (DB-D2)

- In the database's Share menu (Full access only, source database only): **Row access** rules, "People in [a Person or Created by property] get [Can view, Can comment, Can edit or Full access] on rows that name them." Up to 10 rules.
- A person's access to a row is the highest of: their access to the database (rows inherit it), the row page's own sharing, and every rule that names them in that row. Rules only add access.
- **Only rows they're in** (a Share level, decision 0007). It gives view on the database page; rows start at none and rules lift the rows that name them. They see its views and properties and only those rows. Everything else is as if the other rows didn't exist: counts, totals, charts, search, exports, relation titles ("1 row you can't open"), rollups and formulas. With "Can add rows" they can add rows (and see them, as Created by); otherwise they can't (forms still work). They never change views for everyone.
- Can edit from a rule lets them change that row's values and content, not the database's structure. If a change would remove their own access (taking themselves out of the Person property), they confirm first: "You'll lose access to this row."
- Changes apply at once. Open views of people whose access changed refresh through live updates.
- The server enforces this on every read and write: queries, row pages, search, mentions and backlinks, relation titles and pickers, rollups, formulas, totals, charts, CSV export, the calendar and timeline APIs, notices (only people who can open the row), form relation questions, and Trash.
- Forms: a rule on Created by lets respondents see their own responses (for example "my QA disputes") and nothing else. Anonymous responses have no Created by, so no rule matches them.
- Live updates for databases with rules never carry row ids; open views just refetch.

## 8. Anonymous form responses (FM-D1)

The [Forms spec](https://app.notion.com/p/6640881fdf6d41c390c8576c2c971b1d) replaces this section. In short:

- Changing Anonymous responses, Who can respond or closing needs Full access.
- Nothing about the sender is stored anywhere: no Created by, no respondents list, no view, no log of the answers. The rate limit is counted in memory.
- "One response per person" needs names: "One response per person needs names. Turn off anonymous responses first."
- File questions work; files are stored as uploaded by Anonymous.
- Texts: "Your name isn't recorded with this form." (fill screen); "Answers can still show who sent them (Person questions, or what people type)." (builder); notice "New anonymous response to 'QA dispute request'".

## 9. Linked views

- "/linked view" lists the databases the person can open. The block keeps its own views (starting as a copy of the source's first view); the header shows the source's icon and title and links to it.
- Rows, values and access come from the source. Rows-only people see only their rows. A source in Trash shows "This database is in Trash."

## 10. ID property (unique ID)

- Numbers rows 1, 2, 3… in creation order, with an optional prefix ("QA-12"). One per database.
- Added to a database that has rows: existing rows are numbered oldest first. Numbers never change and are never reused after a delete. A duplicated row gets a new number; a duplicated database keeps its numbers and carries on. Imports number rows in file order.
- Not editable and not importable (CSV import offers Text or Skip). Filters: number filters on the number. Search matches "QA-12" and "12". Sorts by number. Changing the prefix changes how every row shows.

## 11. Other Notion options

- **Number**: Number, Number with commas, Percent or Currency (the common currencies first, then any ISO code, shown like "€1,234.50"); decimals automatic or 0–4; show as Number, Bar or Ring, with a color, "Divide by" (default 100) and "Show number".
- **Date formats**: Full (Oct 26, 2026), Month/Day/Year, Day/Month/Year, Year/Month/Day, Relative; time 12-hour, 24-hour, hidden, or the viewer's setting.
- **Property descriptions**: up to 280 characters, shown on hover over the column header and next to the label on row pages.
- **Views**: "Open pages in" side peek (default), center peek or full page; "Show page icon"; "Load limit" 10, 25, 50, 100 or 200 rows (default 50 everywhere), then "Load more" (per group).
- **Board**: sub-groups (lanes by a second property) and "Color columns".
- **Filters**: up to 3 layers (the top plus 2 levels of nested groups), as in Notion. This replaces the spec's one level.
- **Table**: wrap per column or for all; vertical lines on or off.
- **Charts**: also horizontal bar and donut, stacked bars (with Split by), cumulative lines, median, and heights S, M, L and XL.
- **Calendar**: show weekends on or off; weeks start on the viewer's setting.
- **Button property**: now, per the Templates and buttons spec.

## 12. How the server computes views

The server answers every query with the shared package: it loads the database's rows (cached per database, refreshed on every write), applies access, computes the formulas and rollups needed, then filters, searches, sorts, groups and totals, and returns 100 rows at a time with group counts and totals. The web uses the same package for instant feedback while saves are in flight.

## 13. Acceptance checks for the additions

These are lane checks, numbered AX so they don't clash with the specs' own DB-29 to DB-46 and FM-16 to FM-21. The specs' checks come first.

- **AX-01** `prop("Score") / prop("Max")` shown as Percent gives "85%"; renaming Score keeps it working; a formula using itself through another is refused with "'Days open' uses itself through 'Late?'."; `formatDate(prop("Due"), "MMM D")` shows "Oct 26".
- **AX-02** Formula and rollup results filter, sort and group by their result kind; a `today()` formula follows the viewer's time zone (America/Denver and Europe/London around midnight).
- **AX-03** A rollup "Sum of Hours" matches a hand count; a related row the viewer can't open isn't counted, and its title and values never reach the browser.
- **AX-04** Totals (sum, average, count empty, percent checked, earliest) match the server over all rows matching the filter, per group when grouped, and survive a reload.
- **AX-05** Timeline bars span start → end; dragging a bar keeps its length; dragging an end changes only that end; rows without dates are under "No date"; the keyboard moves a bar.
- **AX-06** The default template fills values and content; "Today" and "Me" resolve for the creator; templates never appear as rows, in search, counts or exports.
- **AX-07** Jordan has "Only rows they're in" on QA reviews and a rule on Agent: he sees only rows naming him, can't add rows (Can add rows is off), gets 403 on other rows by URL, and totals, charts, search, relation titles and exports cover only his rows. Taking him out of Agent removes his access at once.
- **AX-08** New rows get the next ID with its prefix ("QA-13"); IDs aren't reused after a delete; searching "QA-12" finds that row.
- **AX-09** Number Bar and Ring (Divide by 100) show; a Euro column shows "€1,234.50" and exports as shown.
- **AX-10** Board sub-groups, Open pages in and Load limit (with Load more per group) work and are saved per view.
- **AX-11** With Anonymous responses on: the row has no Created by and shows "Anonymous"; Name is "Anonymous response"; the notice names nobody; turning on "One response per person" is refused with "One response per person needs names. Turn off anonymous responses first."; no table links a person to an anonymous row.
- **AX-12** A rule on Created by lets a respondent see their own responses and nothing else.

## 14. If time runs short

Dropped first, in this order: Dashboard view, Feed view, Excel import, chart extras (palette, reference line, smooth lines), timeline on phones beyond the table, number Ring, board sub-groups, repeating templates, per-view default templates. Everything else is core.
