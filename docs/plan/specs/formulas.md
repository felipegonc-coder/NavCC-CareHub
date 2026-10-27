# Formulas

_Copied from the Notion spec (https://app.notion.com/p/79b23fda5f624034a964c8df4ca2ff86) on 2026-10-27. If they differ, Notion wins._

> 🧮 Phase 2 · Depends on: Databases · Used by: database formulas, rollups, buttons and automations · Felipe's answer DB-D1 (now)

## 1. What it's for

Formula properties work out a value for each row from its other properties, its related rows and dates, for example "days since the review" or "Pass when the score is 90 or more". Buttons and automations use the same language to set values.

## 2. Screens and states

- **Formula editor** (from the property's settings, or by clicking a formula cell when the person may edit the formula): a code box (monospace, line numbers, colors, bracket matching, suggestions), a live result for the current row (or the first row) under it, and a side list of **Properties** (with their types) and **Functions** (grouped as in section 3.3). Picking an item inserts it; hovering or focusing one shows its description and an example. Buttons: Done and Cancel.
- Properties show as chips with the property's name and type icon. Typing a property's name and choosing it, or typing prop("Name"), makes a chip.
- **States:** valid: the result and its type under the code ("Number · 42"). Invalid: a red wavy line under the problem and a plain message ("Missing ')' at line 2", "Text and a number can't be added. Use format() to make the number text."); Done is disabled. No rows yet: "No rows yet. The preview uses empty values." A formula that breaks later (a property it uses was deleted) shows "⚠ Formula error" in its column header.

## 3. Behavior and edge cases

### 3.1 Basics

- A formula is made of values, properties, operators and functions. Spaces and line breaks don't matter. Comments look like `/* this */`.
- **Values:** numbers (3, 2.5, -1), text in double quotes (`"Pass"`; write `\"` for a quote and `\n` for a new line), true and false, and lists in square brackets (`[1, 2, 3]`).
- **Types:** Number, Text, Checkbox (true or false), Date (a moment or a range, with or without a time), Person, Row (a page from a relation) and List (of any one type). **Empty** is a value of its own: an empty cell gives empty, and most functions given empty return empty. 0, false and "" with spaces aren't empty; "" is.
- Every formula has one result type, worked out when it's saved. If the branches of if() or ifs() would give different types, it's refused: "if() has to give the same type both ways; it gives Number and Text."
- People use a Person property's value as a list of persons, even when the property allows one person. Relations give a list of rows.

### 3.2 Operators

From first to last:

| Operator | Meaning |
| --- | --- |
| `( )` | Grouping |
| `.` | Calls a function on the value before it: x.length() is length(x) |
| `not, !` | Not |
| `^` | Power; 2\^3\^2 is 2\^9 |
| `  • / %` | Multiply, divide, remainder |
| `  • −` | Add and subtract; + also joins two texts |
| `> >= < <=` | Compare numbers, texts (A→Z, ignoring case) or dates |
| `== !=` | Equal and not equal (any two values of the same type; lists item by item) |
| `and, &&` | Both true |
| `or, double bar` | Either true |
| `condition ? a : b` | a if the condition is true, otherwise b |

- Text + Number, and comparing two different types, are errors; comparing anything with empty is allowed.
- Dividing by 0 gives empty.

### 3.3 Functions

**Logic**

| Function | Gives |
| --- | --- |
| `if(condition, then, otherwise)` | then or otherwise |
| `ifs(c1, v1, c2, v2, …, otherwise)` | the value after the first true condition |
| `and(a, b, …) · or(a, b, …) · not(a)` | true or false |
| `empty(x)` | true if x is empty |
| `let(name, value, formula) · lets(n1, v1, n2, v2, …, formula)` | the formula, using the names |

**Text**

| Function | Gives |
| --- | --- |
| `length(text)` | the number of characters (for a list: its items) |
| `substring(text, start, end)` | characters from start (counting from 0) up to, not including, end; end is optional |
| `contains(text, part)` | whether part appears (case matters; use lower() first to ignore case) |
| `test(text, pattern) · match(text, pattern)` | whether a pattern matches · the list of matches |
| `replace(text, pattern, new) · replaceAll(…)` | the text with the first match · every match replaced |
| `lower · upper · trim` | lower case · upper case · without spaces at both ends |
| `repeat(text, n) · padStart(text, length, pad) · padEnd(…)` | repeated text · text padded to a length |
| `split(text, separator) · join(list, separator)` | a list of texts · one text |
| `format(value)` | any value as text, as it shows in a cell |
| `toNumber(value)` | a number from text ("12.5"), a date (milliseconds since 1970) or true/false (1/0); empty if it can't |
| `link(label, address)` | clickable text |
| `style(text, "b", "i", "u", "s", "c", "red", "red_background", …) · unstyle(text, styles)` | formatted text (bold, italic, underline, strikethrough, code, the 10 colors and backgrounds) · without those styles |

**Numbers**

| Function | Gives |
| --- | --- |
| `add · subtract · multiply · divide · mod · pow` | the same as the operators |
| `abs · sign · ceil · floor · sqrt · cbrt · exp · ln · log10 · log2` | the usual maths |
| `round(number, places)` | rounded half away from zero; places is optional (0) |
| `min · max · sum · mean · median` | over numbers or lists of numbers, mixed freely |
| `pi() · e()` | the constants |

**Dates** (a date without a time is a calendar day; with a time it's a moment, shown in the viewer's time zone or the property's fixed one)

| Function | Gives |
| --- | --- |
| `now() · today()` | the current moment · today's date in the viewer's time zone |
| `minute · hour · date · day · week · month · year` | minute, hour, day of the month, day of the week (1 Monday to 7 Sunday), week of the year (ISO), month (1–12), year |
| `dateAdd(date, n, unit) · dateSubtract(date, n, unit)` | a later or earlier date; units "years", "quarters", "months", "weeks", "days", "hours", "minutes" |
| `dateBetween(a, b, unit)` | whole units from b to a (negative if a is earlier) |
| `dateRange(start, end) · dateStart(range) · dateEnd(range)` | a range · its start · its end |
| `formatDate(date, pattern)` | text, with patterns such as "MMM D, YYYY", "YYYY-MM-DD", "dddd" and "h:mm A" |
| `parseDate(text)` | a date from "2026-10-26" or "2026-10-26T15:30"; empty if it can't |
| `timestamp(date) · fromTimestamp(n)` | milliseconds since Jan 1, 1970 (UTC) · the date for them |

**People and rows**

| Function | Gives |
| --- | --- |
| `prop("Name")` | this row's value of that property |
| `row.prop("Name")` | a related row's value (only rows and properties the viewer may open) |
| `name(person) · email(person)` | the person's name · sign-in email |
| `id() · id(row)` | this row's ID · that row's ID, as text |

**Lists** (inside a condition or formula, current is the item and index its position from 0)

| Function | Gives |
| --- | --- |
| `at(list, i) · first(list) · last(list)` | one item (a negative i counts from the end) |
| `slice(list, start, end) · reverse · unique · flat · concat(list, list, …)` | a new list |
| `sort(list, formula)` | sorted by value, or by the formula; empty values last |
| `filter · find · findIndex · some · every (list, condition)` | the matching items · the first match · its position · whether any match · whether all match |
| `map(list, formula)` | a list of the formula for each item |
| `includes(list, value) · length(list)` | whether it's there · how many |

### 3.4 Limits

- Up to 10,000 characters per formula. Formulas can use other formulas and rollups up to 10 levels deep. A formula that depends on itself is refused: "'Days open' uses itself through 'Late?'."
- Reading through relations goes at most 2 relations away (a related row's related rows).
- Each formula gets 50 ms per row; slower ones show "⚠ Too slow" in the cell, and the editor says where. Patterns (test, match, replace) are run with a safe engine and a time limit ("⚠ Pattern too slow").
- Lists in results show at most 100 items, then "+12 more".

### 3.5 Results

- Numbers use the Number formats (including currency and bar or ring); dates use the Date formats; checkboxes show a read-only tick; people show pictures; rows show chips (with the 🔒 note for rows the viewer can't open); text keeps style() and link().
- The server works results out for each viewer; the browser uses the same code for previews, from one shared package, so they always agree.
- When an input changes, everyone sees the new result within 2 seconds. Results that use now() or today() are worked out when the view loads, in the viewer's time zone, and refresh every minute while shown.
- Results that don't depend on the viewer or the time may be cached; any change to an input clears the cache.
- In buttons and automations, formulas run on the row the action works on, and their extra values (for example "the person who clicked") show in the Properties list.

## 4. Data it stores

- **Formula settings** (part of the property): the formula as written, with properties stored by ID so renames don't break it; its result type; number or date format.
- Results aren't stored, apart from the short-lived cache.

## 5. Permissions

- Changing a formula: Can edit on the database, with Lock structure off. Seeing results: Can view on the row.
- Results never use rows or properties the viewer can't open (see Databases, row and property access).

## 6. Keyboard and phone

- The editor works fully by keyboard: Ctrl+Space shows suggestions, Enter or Tab accepts, Esc closes the suggestions and then the editor, Ctrl+Enter saves.
- Screen readers hear errors when they appear; suggestions are a list with their descriptions.
- Phone: the editor opens full screen with a row of extra keys above the keyboard: ( ) " , . + − \* / and = .

## 7. Acceptance checks

- **FX-01** A test set of at least 200 formulas with known answers (every function and operator, plus empty and error cases) gives the same results in the browser and on the server.
- **FX-02** `if(prop("Score") >= 90, "Pass", "Review")` shows the right word and updates within 2 seconds after another person changes Score.
- **FX-03** `dateBetween(today(), prop("Review date"), "days")` is right just before and after midnight for viewers in America/Denver and Europe/London.
- **FX-04** A syntax error shows its line and message with Done disabled; Text + Number suggests format().
- **FX-05** Renaming a property used in a formula keeps it working; deleting it shows "⚠ Formula error".
- **FX-06** Two formulas that use each other are refused with a message naming both.
- **FX-07** `prop("Tasks").filter(current.prop("Status") == "Done").length()` counts only related rows the viewer can open.
- **FX-08** A formula over 50 ms per row shows "⚠ Too slow", and a runaway pattern stops safely.
- **FX-09** Formula results filter, sort and export by their result type, with number formats and bar or ring.
- **FX-10** The editor works by keyboard, with a screen reader and on a phone; axe finds no serious problems.

## Decisions for Felipe

None.
