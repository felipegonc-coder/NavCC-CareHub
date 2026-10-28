/**
 * Shared formula examples: formulas as typed, each with the value or message it gives in the
 * fixture workspace (fixture-workspace.ts).
 */
import type { ComputedValue } from '../types';
import { CASE_ROW, CASES_SCHEMA, fixtureContext } from './fixture-workspace';
import { compileFormula, toStoredFormula } from './index';

export * from './fixture-workspace';

/** A value made easy to compare: empty is null, dates are { date: "start" or "start/end" }. */
export type Simple =
  | null
  | number
  | string
  | boolean
  | { date: string }
  | { person: string }
  | { row: string }
  | Simple[];

/** A ComputedValue as a Simple (errors as { error }). */
export function simplify(v: ComputedValue): Simple | { error: string } {
  switch (v.kind) {
    case 'empty':
      return null;
    case 'text':
    case 'number':
    case 'boolean':
      return v.value;
    case 'date':
      return { date: v.value.end ? `${v.value.start}/${v.value.end}` : v.value.start };
    case 'person':
      return { person: v.value };
    case 'page':
      return { row: v.value };
    case 'list':
      return v.value.map((x) => simplify(x) as Simple);
    case 'error':
      return { error: v.message };
  }
}

/** One example: a formula as typed, with the value it gives or the message it shows. */
export interface FormulaFixture {
  formula: string;
  value?: Simple;
  error?: string;
}

/** Saves (names → ids), compiles and runs a fixture on the Cases row. */
export function runFixture(f: FormulaFixture): { value: Simple } | { error: string } {
  const stored = toStoredFormula(f.formula, CASES_SCHEMA);
  if (!stored.ok) return { error: stored.error.message };
  const compiled = compileFormula(stored.expression, CASES_SCHEMA);
  if (!compiled.ok) return { error: compiled.error.message };
  const v = compiled.run(CASE_ROW, fixtureContext());
  return v.kind === 'error' ? { error: v.message } : { value: simplify(v) as Simple };
}

const v = (formula: string, value: Simple): FormulaFixture => ({ formula, value });
const x = (formula: string, error: string): FormulaFixture => ({ formula, error });
const d = (date: string) => ({ date });

const RELATION_DEPTH = 'Formulas can read related rows at most 2 relations away.';
const UNIT_HELP = 'Use years, quarters, months, weeks, days, hours, minutes or seconds.';

/** The examples (FX-01): every function and operator, plus empty and error cases. */
export const FORMULA_FIXTURES: FormulaFixture[] = [
  // Operators and precedence
  v('1 + 2', 3),
  v('2 * 3 + 4', 10),
  v('2 * (3 + 4)', 14),
  v('10 / 4', 2.5),
  v('7 % 3', 1),
  v('2 ^ 3 ^ 2', 512),
  v('-2 ^ 2', 4),
  v('10 - 2 - 3', 5),
  v('1 / 0', null),
  v('5 % 0', null),
  v('-(3 + 4)', -7),
  v('1.5 * 2', 3),
  v('1e3 + 1', 1001),
  v('"Avery" + " " + "Lin"', 'Avery Lin'),
  x('"Score: " + 5', "Text and a number can't be added. Use format() to make the number text."),
  x('true + 1', '+ needs numbers or text'),
  x('"a" - "b"', '- needs numbers'),
  x('-"a"', '- needs numbers'),
  v('3 > 2', true),
  v('"apple" < "Banana"', true),
  v('2 >= 2', true),
  v('2 <= 1', false),
  v('2 == 2', true),
  v('2 != 3', true),
  v('[1, 2] == [1, 2]', true),
  v('[1, 2] == [2, 1]', false),
  x('1 == "1"', "Number and Text can't be compared."),
  x('"a" > 1', "Text and Number can't be compared."),
  x('[1] > [2]', '> needs numbers, text or dates'),
  v('true and false', false),
  v('true && true', true),
  v('false or true', true),
  v('false || false', false),
  v('not true', false),
  v('!false', true),
  v('true ? "yes" : "no"', 'yes'),
  v('1 > 2 ? 1 : 2', 2),
  v('false ? 1 : true ? 2 : 3', 2),
  v('1 + 2 > 2 and 3 < 4', true),
  // Logic
  x('if(true, 1, "a")', 'if() has to give the same type both ways; it gives Number and Text.'),
  x('if(1, 2, 3)', 'if() needs Checkbox here; it gets Number.'),
  v('if(prop("Done"), "Closed", "Open")', 'Open'),
  v('ifs(false, 1, true, 2, 3)', 2),
  v('ifs(false, 1, false, 2, 3)', 3),
  v('ifs(false, 1)', null),
  v('and(true, true, false)', false),
  v('or(false, false, true)', true),
  x('and(true)', 'and() takes at least 2 inputs; it gets 1.'),
  x('not(1)', 'not() needs Checkbox here; it gets Number.'),
  v('empty("")', true),
  v('empty(0)', false),
  v('empty(" ")', false),
  v('empty([])', true),
  v('empty(false)', false),
  v('empty(prop("Budget"))', true),
  v('equal(prop("Status"), "Open")', true),
  v('unequal(1, 2)', true),
  v('let(x, 2, x * x)', 4),
  v('lets(a, 1, b, a + 1, a + b)', 3),
  v('let(x, 2, let(x, 3, x) + x)', 5),
  x('let(x, 1)', 'let() takes 3 inputs; it gets 2.'),
  x('let(1, 2, 3)', 'let() needs a name first, like let(total, 1 + 2, total * 2).'),
  x('lets(a, 1, b, 2)', 'lets() takes names and values in pairs, then one more input; it gets 4.'),
  // Numbers
  v('abs(-4)', 4),
  v('sign(-3)', -1),
  v('ceil(1.2)', 2),
  v('floor(-1.2)', -2),
  v('sqrt(16)', 4),
  v('sqrt(-1)', null),
  v('cbrt(27)', 3),
  v('exp(0)', 1),
  v('ln(1)', 0),
  v('ln(0)', null),
  v('log10(1000)', 3),
  v('log2(8)', 3),
  v('round(2.5)', 3),
  v('round(-2.5)', -3),
  v('round(1.005, 2)', 1.01),
  v('round(1234.5678, -2)', 1200),
  v('round(prop("Score"))', 43),
  x('round(1, 2, 3)', 'round() takes 1 or 2 inputs; it gets 3.'),
  x('round("a")', 'round() needs Number here; it gets Text.'),
  v('min(3, 1, 2)', 1),
  v('max([4, 9], 2)', 9),
  v('sum(1, 2, 3)', 6),
  v('sum([])', 0),
  v('min([])', null),
  x('sum()', 'sum() takes at least 1 input; it gets 0.'),
  v('mean(2, 4)', 3),
  v('median(5, 1, 3)', 3),
  v('median(1, 2, 3, 4)', 2.5),
  v('round(pi(), 2)', 3.14),
  v('round(e, 3)', 2.718),
  x('pi(1)', 'pi() takes no inputs; it gets 1.'),
  v('pow(2, 10)', 1024),
  v('mod(10, 3)', 1),
  v('divide(1, 0)', null),
  v('add("a", "b")', 'ab'),
  v('subtract(10, 4)', 6),
  v('multiply(3, 4)', 12),
  v('5.abs()', 5),
  v('-5.abs()', -5),
  // Text
  v('length("Avery")', 5),
  v('length("👋 hi")', 4),
  v('substring("Avery Lin", 6)', 'Lin'),
  v('substring("Avery Lin", 0, 5)', 'Avery'),
  v('contains("Blue Pine Plumbing", "Pine")', true),
  v('contains("Blue Pine", "pine")', false),
  v('lower("AVERY")', 'avery'),
  v('upper("lin")', 'LIN'),
  v('trim("  hi  ")', 'hi'),
  v('repeat("ab", 3)', 'ababab'),
  v('padStart("7", 3, "0")', '007'),
  v('padEnd("ab", 4)', 'ab  '),
  v('split("a,b,c", ",")', ['a', 'b', 'c']),
  v('split("hi", "")', ['h', 'i']),
  v('join(["a", "b"], "-")', 'a-b'),
  v('format(1234.5)', '1234.5'),
  v('format(true)', 'true'),
  v('format(prop("Due"))', 'Oct 30, 2026'),
  v('format([1, 2, 3])', '1, 2, 3'),
  v('"5" + format(5)', '55'),
  v('toNumber("42")', 42),
  v('toNumber("45%")', 0.45),
  v('toNumber("$1,234.50")', 1234.5),
  v('toNumber("abc")', null),
  v('toNumber(true)', 1),
  v('link("Site", "javascript:alert(1)")', 'Site'),
  v('link("Site", "https://example.com")', 'Site'),
  v('style("Hi", "b", "red")', 'Hi'),
  x(
    'style("Hi", "x")',
    `"x" isn't a style. Use b, i, u, s, c, a color, or a color with _background.`,
  ),
  v('unstyle(style("Hi", "b"))', 'Hi'),
  v('test("abc", "b")', true),
  x('upper(1)', 'upper() needs Text here; it gets Number.'),
  x('length(1)', 'length() needs Text or List here; it gets Number.'),
  v('"a\\"b"', 'a"b'),
  v('"line\\nbreak"', 'line\nbreak'),
  v('"C:\\\\temp"', 'C:\\temp'),
  v('"a" /* a note */ + "b"', 'ab'),
  v('"Avery".upper().length()', 5),
  // Properties
  v('prop("Name")', 'Avery Lin intake'),
  v('prop("Score")', 42.5),
  v('prop("score") + 1', 43.5),
  v('prop("Notes")', 'Leak under the kitchen sink'),
  v('prop("Notes") + "!"', 'Leak under the kitchen sink!'),
  v('prop("Tags")', ['Urgent', 'Plumbing']),
  v('prop("Status")', 'Open'),
  v('prop("Done")', false),
  v('prop("Due")', d('2026-10-30')),
  v('prop("Owner")', [{ person: 'u_avery' }, { person: 'u_jordan' }]),
  v('prop("Steps")', 0.5),
  v('prop("Ticket")', 'QA-12'),
  v('prop("Case number")', 12),
  v('prop("Website")', 'https://example.com/avery'),
  v('prop("Email")', 'avery@example.com'),
  v('prop("Phone")', '555-0100'),
  v('prop("Created")', d('2026-10-20T15:30:00.000Z')),
  v('prop("Created by")', { person: 'u_jordan' }),
  v('prop("Files")', ['photo.jpg']),
  v('prop("Total") * 2', 84),
  v('prop("Budget") + 1', null),
  v('prop("Budget") > 1', false),
  x('prop("Broken")', 'Property "Broken" has an error.'),
  x('prop("Go")', 'Property "Go" is a button, which has no value.'),
  x('prop("Scroe")', `Property "Scroe" doesn't exist.`),
  x('prop("Old score")', 'Property "Old score" was deleted.'),
  x('prop("Late fee")', 'This formula is too complex.'),
  x('Score + 1', 'Use prop("Score") to read a property.'),
  x('foo(1)', 'Unknown function "foo".'),
  x('bar', 'Unknown name "bar".'),
  x('prop(1)', 'prop() needs a property name in quotes, like prop("Score").'),
  x('prop("Score", 1)', 'prop() takes 1 input; it gets 2.'),
  // Relations, people and rows
  v('prop("Tasks").length()', 2),
  v('prop("Tasks").map(current.prop("Hours"))', [2, 1.5]),
  v('sum(prop("Tasks").map(current.prop("Hours")))', 3.5),
  v('prop("Tasks").filter(current.prop("Done")).map(current.prop("Name"))', ['Fix sink']),
  v('prop("Tasks").first().prop("Project").first().prop("Client")', 'Blue Pine Plumbing'),
  x(
    'prop("Tasks").first().prop("Project").first().prop("Parent").first().prop("Name")',
    RELATION_DEPTH,
  ),
  v('format(prop("Tasks"))', 'Fix sink, Call Blue Pine Plumbing'),
  x('prop("Tasks").first().prop("Nope")', `Property "Nope" doesn't exist.`),
  v('prop("Tasks").some(current.prop("Hours") > 1.5)', true),
  v('prop("Tasks").every(current.prop("Done"))', false),
  v('prop("Tasks").find(current.prop("Hours") < 2).prop("Name")', 'Call Blue Pine Plumbing'),
  v('prop("Tasks").findIndex(current.prop("Done") == false)', 1),
  v('prop("Tasks").sort(current.prop("Hours")).map(current.prop("Name"))', [
    'Call Blue Pine Plumbing',
    'Fix sink',
  ]),
  x('prop("Score").prop("Name")', 'prop() needs Row here; it gets Number.'),
  v('id()', 'case_1'),
  v('id(prop("Tasks").first())', 't_fix'),
  v('id(prop("Created by"))', 'u_jordan'),
  v('name(prop("Created by"))', 'Jordan Park'),
  v('name(prop("Owner"))', ['Avery Lin', 'Jordan Park']),
  v('email(prop("Created by"))', 'jordan@example.com'),
  v('prop("Owner").map(name(current)).join(" & ")', 'Avery Lin & Jordan Park'),
  // Lists
  v('[1, 2, 3].at(1)', 2),
  v('at([1, 2, 3], -1)', 3),
  v('at([1], 5)', null),
  v('first([3, 4])', 3),
  v('last([3, 4])', 4),
  v('slice([1, 2, 3, 4], 1, 3)', [2, 3]),
  v('reverse([1, 2, 3])', [3, 2, 1]),
  v('unique([1, 2, 1, 3, 2])', [1, 2, 3]),
  v('flat([[1, 2], [3]])', [1, 2, 3]),
  v('concat([1], [2, 3])', [1, 2, 3]),
  v('sort([3, 1, 2])', [1, 2, 3]),
  v('sort(["b", "A", "c"])', ['A', 'b', 'c']),
  v('[1, 2, 3].filter(current > 1)', [2, 3]),
  v('[1, 2, 3].map(current * 10)', [10, 20, 30]),
  v('[1, 2, 3].map(index)', [0, 1, 2]),
  v('map([1, 2], current + index)', [1, 3]),
  v('[1, 2].map([5, 6].map(current * 2))', [
    [10, 12],
    [10, 12],
  ]),
  v('[1, 2, 3].some(current == 2)', true),
  v('[1, 2, 3].every(current > 0)', true),
  v('[].every(current > 0)', true),
  v('[1, 2, 3].find(current > 1)', 2),
  v('[1, 2, 3].findIndex(current > 5)', -1),
  v('includes([1, 2], 2)', true),
  v('includes(prop("Tags"), "Urgent")', true),
  v('length([1, 2, 3])', 3),
  v('[[1, 2], [3]].map(current.length())', [2, 1]),
  x('[1, "a"]', 'A list has to hold one type; it holds Number and Text.'),
  x('current + 1', 'current only works inside a list function such as map() or filter().'),
  x('includes([1, 2], "a")', 'includes() needs Number here; it gets Text.'),
  x('concat([1], ["a"])', 'concat() needs List of Number here; it gets List of Text.'),
  x('map(1, current)', 'map() needs List here; it gets Number.'),
  // Dates
  v('now()', d('2026-10-26T18:00:00.000Z')),
  v('today()', d('2026-10-26')),
  v('day(today())', 1),
  v('date(prop("Due"))', 30),
  v('month(prop("Due"))', 10),
  v('year(prop("Due"))', 2026),
  v('hour(now())', 12),
  v('minute(now())', 0),
  v('week(prop("Due"))', 44),
  v('dateAdd(prop("Due"), 3, "days")', d('2026-11-02')),
  v('dateAdd(prop("Due"), 1, "months")', d('2026-11-30')),
  v('dateSubtract(prop("Due"), 1, "weeks")', d('2026-10-23')),
  v('dateAdd(now(), 2, "hours")', d('2026-10-26T20:00:00.000Z')),
  v('dateAdd(now(), 1, "days")', d('2026-10-27T18:00:00.000Z')),
  v('dateAdd(now(), 7, "days")', d('2026-11-02T19:00:00.000Z')),
  x('dateAdd(today(), 1, "fortnights")', `"fortnights" isn't a date unit. ${UNIT_HELP}`),
  v('dateBetween(prop("Due"), today(), "days")', 4),
  v('dateBetween(today(), prop("Due"), "days")', -4),
  v('dateBetween(prop("Due"), now(), "days")', 3),
  v('dateBetween(prop("Due"), now(), "hours")', 84),
  v('dateBetween(dateAdd(today(), 1, "years"), today(), "months")', 12),
  v('dateBetween(parseDate("2026-03-31"), parseDate("2026-02-28"), "months")', 1),
  v('dateBetween(parseDate("2026-03-27"), parseDate("2026-02-28"), "months")', 0),
  v('formatDate(prop("Due"), "MMMM D, YYYY")', 'October 30, 2026'),
  v('formatDate(now(), "YYYY-MM-DD h:mm A")', '2026-10-26 12:00 PM'),
  v('formatDate(prop("Due"), "dddd [the] Do")', 'Friday the 30th'),
  v('parseDate("2026-10-26")', d('2026-10-26')),
  v('parseDate("2026-10-26T14:30")', d('2026-10-26T20:30:00.000Z')),
  v('parseDate("nope")', null),
  v('fromTimestamp(0)', d('1970-01-01T00:00:00.000Z')),
  v('timestamp(fromTimestamp(1000))', 1000),
  v('toNumber(fromTimestamp(5000))', 5000),
  v('dateRange(prop("Due"), today())', d('2026-10-26/2026-10-30')),
  v('dateRange(today(), now())', d('2026-10-26T06:00:00.000Z/2026-10-26T18:00:00.000Z')),
  v('dateStart(dateRange(today(), prop("Due")))', d('2026-10-26')),
  v('dateEnd(dateRange(today(), prop("Due")))', d('2026-10-30')),
  v('prop("Due") > today()', true),
  v('prop("Due") == parseDate("2026-10-30")', true),
  v('prop("Start") < now()', true),
  // Patterns (re2js): JavaScript syntax, linear time, plain messages
  v('test("Avery Lin", "Lin$")', true),
  v('test("avery", "^A")', false),
  v('test(prop("Phone"), "^\\\\d{3}-\\\\d{4}$")', true),
  v('prop("Email").test("@example\\\\.com$")', true),
  v('test(prop("Ticket"), "^QA-\\\\d+$")', true),
  v('test(prop("Status"), "Open|Done")', true),
  v('test("Line one\\nLine two", "^Line two$")', false),
  v('test("Line one\\nLine two", "(?m)^Line two$")', true),
  v('test("", "")', true),
  v('test("", "a")', false),
  v('match("a1b22c333", "\\\\d+")', ['1', '22', '333']),
  v('match("Case 12, Case 7", "Case (\\\\d+)")', ['Case 12', 'Case 7']),
  v('match("AbC abc", "(?i)abc")', ['AbC', 'abc']),
  v('match(prop("Email"), "^[^@]+")', ['avery']),
  v('match("😀a😀", ".")', ['😀', 'a', '😀']),
  v('match("no digits", "\\\\d")', []),
  v('empty(match("abc", "x"))', true),
  v('length(match("one two three", "\\\\w+"))', 3),
  v('match("x1y2", "[0-9]").map(toNumber(current)).sum()', 3),
  v('replace("2026-10-26", "-", "/")', '2026/10-26'),
  v('replaceAll("2026-10-26", "-", "/")', '2026/10/26'),
  v('replace("Avery Lin", "(\\\\w+) (\\\\w+)", "$2, $1")', 'Lin, Avery'),
  v(
    'replace("2026-10-26", "(?<y>\\\\d{4})-(?<m>\\\\d{2})-(?<d>\\\\d{2})", "$<d>/$<m>/$<y>")',
    '26/10/2026',
  ),
  v('replace("abc", "b", "$&$&")', 'abbc'),
  v('replace("cost: 5", "\\\\d", "$$")', 'cost: $'),
  v('replace("abc", "B", "x")', 'abc'),
  v('replaceAll("a  b   c", " +", " ")', 'a b c'),
  v('replaceAll("abc", "", "-")', '-a-b-c-'),
  v('replaceAll("Tél: 555", "\\\\p{L}", "*")', '***: 555'),
  v('"x-y-z".replaceAll("-", "+")', 'x+y+z'),
  v('prop("Website").replace("^https?://", "")', 'example.com/avery'),
  v('replace(format(prop("Score")), "\\\\.", ",")', '42,5'),
  v('replaceAll(format(prop("Budget")), "a", "b")', ''),
  x('test("abc", "(")', "This pattern isn't valid: a '(' has no ')'."),
  x('match("x", "[")', "This pattern isn't valid: a '[' has no ']'."),
  x('test("abc", "a{2,1}")', "This pattern isn't valid: a repeat count is backwards."),
  x('test("abc", "*a")', "This pattern isn't valid: a repeat has nothing before it."),
  x('test("abc", "(?=a)")', "Patterns can't look ahead, look behind or refer back to a group."),
  x(
    'replace("aa", "(a)\\\\1", "")',
    "Patterns can't look ahead, look behind or refer back to a group.",
  ),
  x('test("x", "((a{100}){100}){100}")', 'This pattern is too complex.'),
  x('test("a", repeat("a", 201))', 'Patterns can be up to 200 characters.'),
  x('test(123, "2")', 'test() needs Text here; it gets Number.'),
  // e()
  v('e()', 2.718281828459045),
  v('round(e(), 3)', 2.718),
  v('ln(e())', 1),
  v('exp(1) == e()', true),
  v('pi() < e()', false),
  // Writing mistakes
  x('round(1', "Missing ')' at line 1"),
  x('round(1,\n2', "Missing ')' at line 2"),
  x('[1, 2', "Missing ']' at line 1"),
  x('1 +', 'Missing a value at line 1'),
  x('1 = 1', "Unexpected '=' at line 1. Use == to compare."),
  x('"abc', `Missing '"' at line 1`),
  x('1 /* note', "Missing '*/' at line 1"),
  x('1 2', "Unexpected '2' at line 1"),
  x('true ? 1', "Missing ':' at line 1"),
  x('1 #', "Unexpected '#' at line 1"),
  v('', null),
  v('/* only a comment */', null),
];
