import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_LAYOUTS,
  COLOR_MESSAGES,
  RULE_COLORS,
  boardColumnColor,
  cellColor,
  colorRows,
  rowColorer,
  validateColorRules,
  type ColorContext,
  type RowColor,
} from './color';
import { validateFilter } from './filter';
import { groupRows } from './group';
import { fromPlainText } from './richtext';
import { defaultConfig } from './schema';
import {
  LIMITS,
  VIEW_LAYOUTS,
  type BoardOptions,
  type ColorRule,
  type ComputedValue,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type FilterValue,
  type Id,
  type Property,
  type PropertyConfig,
  type Row,
  type View,
  type ViewLayout,
  type Viewer,
} from './types';

const viewer: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00.000Z'),
};

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const name = prop('p-name', 'Name', { type: 'title' });
const stage = prop('p-stage', 'Stage', {
  type: 'select',
  options: [
    { id: 'o-open', name: 'Open', color: 'blue' },
    { id: 'o-done', name: 'Done', color: 'green' },
    { id: 'o-hold', name: 'On hold', color: 'default' },
  ],
});
const score = prop('p-score', 'Score', defaultConfig('number'));
const notes = prop('p-notes', 'Notes', { type: 'text' });
const urgent = prop('p-urgent', 'Urgent', { type: 'checkbox' });
const late = prop('p-late', 'Late?', {
  type: 'formula',
  expression: 'prop("p-score") < 80',
  resultKind: 'boolean',
  number: null,
});
const properties = [name, stage, score, notes, urgent, late];

const row = (id: string, title: string, values: Row['values']): Row => ({
  id,
  title,
  values,
  createdAt: '2026-10-20T15:00:00.000Z',
  createdBy: 'u-jordan',
  editedAt: '2026-10-26T15:00:00.000Z',
  editedBy: 'u-jordan',
  uniqueNumber: null,
});
const r1 = row('r1', 'Call back Blue Pine Plumbing', {
  'p-stage': 'o-done',
  'p-score': '95',
  'p-urgent': true,
  'p-notes': fromPlainText('Leak fixed'),
});
const r2 = row('r2', 'Review Avery Lin', { 'p-stage': 'o-open', 'p-score': '72' });
const r3 = row('r3', 'Coach Jordan Park', {
  'p-stage': 'o-hold',
  'p-score': '60',
  'p-urgent': true,
});
const r4 = row('r4', '', {});
const rows = [r1, r2, r3, r4];

const cond = (propertyId: Id, op: FilterOp, value?: FilterValue): FilterCondition => ({
  kind: 'condition',
  id: `c-${propertyId}-${op}`,
  propertyId,
  op,
  ...(value === undefined ? {} : { value }),
});
const all = (...children: FilterNode[]): FilterGroup => ({
  kind: 'group',
  id: 'g-all',
  combinator: 'and',
  children,
});
const any = (...children: FilterNode[]): FilterGroup => ({
  kind: 'group',
  id: 'g-any',
  combinator: 'or',
  children,
});
const rowRule = (id: Id, color: ColorRule['color'], filter: FilterGroup): ColorRule => ({
  id,
  filter,
  target: { kind: 'row' },
  color,
});
const cellRule = (
  id: Id,
  propertyId: Id,
  color: ColorRule['color'],
  filter: FilterGroup,
): ColorRule => ({ id, filter, target: { kind: 'property', propertyId }, color });

const board = (colorColumns: boolean): BoardOptions => ({
  cardPreview: { kind: 'none' },
  cardSize: 'm',
  fitImage: false,
  colorColumns,
});
const view = (colorRules: ColorRule[] | undefined, layout: ViewLayout = 'table'): View => ({
  id: 'v-1',
  name: 'Table',
  layout,
  filter: null,
  sorts: [],
  grouping: null,
  subGrouping: null,
  properties: properties.map((p) => ({ propertyId: p.id, visible: true })),
  manualOrder: [],
  openPagesIn: 'side_peek',
  showPageIcon: true,
  loadLimit: 50,
  calculations: {},
  ...(colorRules ? { colorRules } : {}),
});

/** Late? is true for Avery's review only. */
const lateValue = (r: Row, propertyId: Id): ComputedValue =>
  propertyId === 'p-late' ? { kind: 'boolean', value: r.id === 'r2' } : { kind: 'empty' };
const context = (
  opts: { hidden?: Id[]; properties?: Property[]; computed?: ColorContext['computed'] } = {},
): ColorContext => ({
  properties: opts.properties ?? properties,
  viewer,
  userName: () => undefined,
  computed: opts.computed ?? lateValue,
  canSeeProperty: (id) => !(opts.hidden ?? []).includes(id),
});
const ctx = context();

const none: RowColor = { row: null, cells: {} };
const colorsOf = (rules: ColorRule[], c: ColorContext = ctx, layout?: ViewLayout) =>
  colorRows(rows, view(rules, layout), c);

const isDone = all(cond('p-stage', 'is', ['o-done']));
const isUrgent = all(cond('p-urgent', 'is_checked'));
const lowScore = all(cond('p-score', 'lt', '80'));

describe('colorRows', () => {
  it('colors a row by the first row rule that matches (DB-39)', () => {
    const [c1, c2, c3, c4] = colorsOf([
      rowRule('a', 'green', isDone),
      rowRule('b', 'red', isUrgent),
    ]);
    expect(c1).toEqual({ row: 'green', cells: {} });
    expect(c2).toEqual(none);
    expect(c3).toEqual({ row: 'red', cells: {} });
    expect(c4).toEqual(none);
  });

  it('colors a cell by a cell rule, which beats the row color in that cell', () => {
    const [, c2, c3] = colorsOf([
      rowRule('a', 'yellow', isUrgent),
      cellRule('b', 'p-score', 'red', lowScore),
    ]);
    expect(c3).toEqual({ row: 'yellow', cells: { 'p-score': 'red' } });
    expect(cellColor(c3 as RowColor, 'p-score')).toBe('red');
    expect(cellColor(c3 as RowColor, 'p-name')).toBe('yellow');
    expect(c2).toEqual({ row: null, cells: { 'p-score': 'red' } });
    expect(cellColor(c2 as RowColor, 'p-notes')).toBeNull();
  });

  it('uses the first cell rule that matches for each property; other cells get theirs', () => {
    const [c1, c2] = colorsOf([
      cellRule('a', 'p-score', 'red', lowScore),
      cellRule('b', 'p-score', 'green', all(cond('p-score', 'gte', '70'))),
      cellRule('c', 'p-stage', 'blue', all(cond('p-stage', 'is', ['o-open']))),
    ]);
    expect(c1).toEqual({ row: null, cells: { 'p-score': 'green' } });
    expect(c2).toEqual({ row: null, cells: { 'p-score': 'red', 'p-stage': 'blue' } });
  });

  it('keeps row and cell rules apart, whatever their order', () => {
    const [c1] = colorsOf([
      cellRule('a', 'p-name', 'purple', isUrgent),
      rowRule('b', 'orange', isUrgent),
      rowRule('c', 'gray', isDone),
    ]);
    expect(c1).toEqual({ row: 'orange', cells: { 'p-name': 'purple' } });
  });

  it('treats Default like any other color, in rows and cells', () => {
    const [c1, c2, c3] = colorsOf([
      rowRule('a', 'default', isDone),
      rowRule('b', 'red', isUrgent),
      cellRule('c', 'p-score', 'default', lowScore),
    ]);
    expect(c1).toEqual({ row: 'default', cells: {} });
    expect(cellColor(c1 as RowColor, 'p-name')).toBe('default');
    expect(c2).toEqual({ row: null, cells: { 'p-score': 'default' } });
    expect(c3).toEqual({ row: 'red', cells: { 'p-score': 'default' } });
    expect(cellColor(c3 as RowColor, 'p-score')).toBe('default');
  });

  it('matches like view filters: Any of, nested groups and text', () => {
    const rule = rowRule(
      'a',
      'brown',
      any(
        cond('p-notes', 'contains', 'leak'),
        all(cond('p-urgent', 'is_checked'), cond('p-score', 'lt', '70')),
      ),
    );
    expect(colorsOf([rule]).map((c) => c.row)).toEqual(['brown', null, 'brown', null]);
  });

  it('uses formula and rollup results', () => {
    const rule = rowRule('a', 'pink', all(cond('p-late', 'is_checked')));
    expect(colorsOf([rule]).map((c) => c.row)).toEqual([null, 'pink', null, null]);
  });

  it('answers for each row in the order given, repeats included', () => {
    const rules = [rowRule('a', 'green', isDone)];
    const out = colorRows([r2, r1, r2], view(rules), ctx);
    expect(out.map((c) => c.row)).toEqual([null, 'green', null]);
    expect(colorRows([], view(rules), ctx)).toEqual([]);
  });

  it('colors nothing in a view without rules', () => {
    expect(colorRows(rows, view(undefined), ctx)).toEqual([none, none, none, none]);
    expect(colorsOf([])).toEqual([none, none, none, none]);
  });

  it('uses only the first 10 rules', () => {
    const misses = Array.from({ length: LIMITS.colorRules - 1 }, (_, i) =>
      rowRule(`miss-${i}`, 'gray', all(cond('p-score', 'gt', '1000'))),
    );
    const hit = rowRule('hit', 'red', isDone);
    expect(colorsOf([...misses, hit])[0]?.row).toBe('red');
    expect(colorsOf([...misses, misses[0] as ColorRule, hit])[0]?.row).toBeNull();
  });

  it('shows colors in tables, lists, boards, galleries, calendars and timelines only', () => {
    expect(COLOR_LAYOUTS).toEqual(['table', 'list', 'board', 'gallery', 'calendar', 'timeline']);
    for (const layout of VIEW_LAYOUTS) {
      const shown = colorsOf([rowRule('a', 'green', isDone)], ctx, layout)[0]?.row ?? null;
      expect(shown).toBe(COLOR_LAYOUTS.includes(layout) ? 'green' : null);
    }
  });
});

describe('rules that are skipped', () => {
  it('skips a rule with a condition on a deleted property instead of widening it', () => {
    const gone = all(cond('p-stage', 'is', ['o-done']), cond('p-gone', 'is_not_empty'));
    expect(colorsOf([rowRule('a', 'red', gone)])).toEqual([none, none, none, none]);
    expect(colorsOf([rowRule('a', 'red', gone), rowRule('b', 'green', isDone)])[0]?.row).toBe(
      'green',
    );
  });

  it('skips a rule that colors the cell of a deleted property', () => {
    expect(colorsOf([cellRule('a', 'p-gone', 'red', isDone)])[0]).toEqual(none);
  });

  it("skips rules that use a property the viewer can't see, in conditions or as the cell", () => {
    const c = context({ hidden: ['p-score'] });
    const rules = [
      rowRule('a', 'red', all(cond('p-score', 'gte', '90'))),
      cellRule('b', 'p-score', 'red', isDone),
      rowRule('c', 'green', isDone),
      cellRule('d', 'p-stage', 'blue', all(cond('p-score', 'is_not_empty'))),
    ];
    expect(colorsOf(rules, c)[0]).toEqual({ row: 'green', cells: {} });
    expect(colorsOf(rules)[0]).toEqual({
      row: 'red',
      cells: { 'p-score': 'red', 'p-stage': 'blue' },
    });
  });

  it('always lets the viewer see Name', () => {
    const c = context({ hidden: properties.map((p) => p.id) });
    const rules = [
      rowRule('a', 'blue', all(cond('p-name', 'contains', 'blue pine'))),
      cellRule('b', 'p-name', 'red', all(cond('p-name', 'is_empty'))),
    ];
    expect(colorsOf(rules, c).map((x) => x.row)).toEqual(['blue', null, null, null]);
    expect(colorsOf(rules, c)[3]).toEqual({ row: null, cells: { 'p-name': 'red' } });
  });

  it('works when the server already left hidden properties out', () => {
    const c = context({ properties: [name, stage, notes, urgent, late] });
    const rules = [rowRule('a', 'red', lowScore), rowRule('b', 'green', isDone)];
    expect(colorsOf(rules, c).map((x) => x.row)).toEqual(['green', null, null, null]);
  });

  it('colors nothing for a rule whose conditions have no value yet', () => {
    const unfinished = [
      all(),
      all(cond('p-stage', 'is')),
      all(cond('p-stage', 'is', [])),
      all(cond('p-notes', 'contains', '')),
      any(cond('p-score', 'gte'), all(cond('p-notes', 'is'))),
      all(cond('p-score', 'contains', 'x')),
    ];
    for (const filter of unfinished) {
      expect(colorsOf([rowRule('a', 'red', filter)])).toEqual([none, none, none, none]);
    }
  });

  it('skips the unfinished conditions of a rule that has others, as filters do', () => {
    const filter = all(cond('p-stage', 'is', ['o-done']), cond('p-score', 'gte'));
    expect(colorsOf([rowRule('a', 'red', filter)]).map((c) => c.row)).toEqual([
      'red',
      null,
      null,
      null,
    ]);
  });

  it('applies conditions that need no value at once', () => {
    const rule = rowRule('a', 'gray', all(cond('p-score', 'is_empty')));
    expect(colorsOf([rule]).map((c) => c.row)).toEqual([null, null, null, 'gray']);
  });
});

describe('rowColorer', () => {
  it('gives the same colors as colorRows, one row at a time', () => {
    const rules = [rowRule('a', 'yellow', isUrgent), cellRule('b', 'p-score', 'red', lowScore)];
    const colorOf = rowColorer(view(rules), ctx);
    expect(rows.map((r) => colorOf(r))).toEqual(colorsOf(rules));
  });

  it('tests each rule only while its row or cell has no color', () => {
    const computed = vi.fn(lateValue);
    const rules = [
      rowRule('a', 'green', isDone),
      rowRule('b', 'red', all(cond('p-late', 'is_checked'))),
    ];
    const colorOf = rowColorer(view(rules), context({ computed }));
    expect(colorOf(r1).row).toBe('green');
    expect(computed).toHaveBeenCalledTimes(0);
    expect(colorOf(r2).row).toBe('red');
    expect(computed).toHaveBeenCalledTimes(1);
  });
});

describe('cellColor', () => {
  it("is the cell's own color, otherwise the row's, otherwise null", () => {
    const colors: RowColor = { row: 'gray', cells: { 'p-score': 'red' } };
    expect(cellColor(colors, 'p-score')).toBe('red');
    expect(cellColor(colors, 'p-stage')).toBe('gray');
    expect(cellColor(none, 'p-stage')).toBeNull();
  });
});

describe('validateColorRules', () => {
  const tenRules = Array.from({ length: 10 }, (_, i) => rowRule(`r-${i}`, 'green', isDone));

  it('accepts no rules and up to 10 rules', () => {
    expect(validateColorRules(undefined, properties)).toBeNull();
    expect(validateColorRules(null, properties)).toBeNull();
    expect(validateColorRules([], properties)).toBeNull();
    expect(validateColorRules(tenRules, properties)).toBeNull();
  });

  it('refuses an 11th rule', () => {
    expect(COLOR_MESSAGES.tooMany).toBe('Up to 10 rules.');
    const eleven = [...tenRules, rowRule('r-10', 'red', isUrgent)];
    expect(validateColorRules(eleven, properties)).toBe('Up to 10 rules.');
  });

  it('accepts cell rules, nested groups and conditions with no value yet', () => {
    const rules = [
      cellRule('a', 'p-score', 'red', any(lowScore, all(cond('p-stage', 'is')))),
      rowRule('b', 'blue', all()),
      cellRule('c', 'p-name', 'purple', all(cond('p-late', 'is_checked'))),
    ];
    expect(validateColorRules(rules, properties)).toBeNull();
  });

  it('accepts every option color, Default included', () => {
    const rules = RULE_COLORS.map((color, i) => rowRule(`r-${i}`, color, isDone));
    expect(rules).toHaveLength(10);
    expect(validateColorRules(rules, properties)).toBeNull();
  });

  const good = rowRule('a', 'green', isDone);
  it.each([
    ['a list that is not one', { not: 'a list' }],
    ['a rule that is not an object', ['rule']],
    ['a rule without an id', [{ ...good, id: 7 }]],
    ['the same id twice', [good, { ...good }]],
    ['a color that is not an option color', [{ ...good, color: 'teal' }]],
    ['no target', [{ ...good, target: null }]],
    ['a target that is neither a row nor a property', [{ ...good, target: { kind: 'column' } }]],
    ['a property target without a property', [{ ...good, target: { kind: 'property' } }]],
    ['no filter', [{ ...good, filter: null }]],
    ['a filter that is a list', [{ ...good, filter: [] }]],
  ])('refuses %s', (_, rules) => {
    expect(COLOR_MESSAGES.invalid).toBe("This color rule isn't valid.");
    expect(validateColorRules(rules as unknown as ColorRule[], properties)).toBe(
      "This color rule isn't valid.",
    );
  });

  it('refuses a cell rule on a property that was deleted', () => {
    expect(COLOR_MESSAGES.deletedProperty).toBe('A color rule uses a property that was deleted.');
    expect(validateColorRules([cellRule('a', 'p-gone', 'red', isDone)], properties)).toBe(
      'A color rule uses a property that was deleted.',
    );
  });

  it("gives the filter's own problem for a rule's conditions", () => {
    const problems = [
      all(cond('p-gone', 'is_empty')),
      all(cond('p-score', 'contains', 'x')),
      all(cond('p-score', 'gt', 'many')),
      { ...isDone, combinator: 'xor' } as unknown as FilterGroup,
    ];
    for (const filter of problems) {
      const expected = validateFilter(filter, properties);
      expect(expected).not.toBeNull();
      expect(validateColorRules([good, rowRule('b', 'red', filter)], properties)).toBe(expected);
    }
    expect(
      validateColorRules([rowRule('b', 'red', all(cond('p-gone', 'is_empty')))], properties),
    ).toBe('A filter uses a property that was deleted.');
  });

  it('offers all 10 option colors, in menu order', () => {
    expect(RULE_COLORS).toEqual([
      'default',
      'gray',
      'brown',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'red',
    ]);
  });
});

describe('boardColumnColor', () => {
  const boardView = (colorColumns: boolean): Pick<View, 'layout' | 'board'> => ({
    layout: 'board',
    board: board(colorColumns),
  });

  it("with Color columns on, is the color of the column's option", () => {
    expect(boardColumnColor({ color: 'blue' }, boardView(true))).toBe('blue');
    expect(boardColumnColor({ color: 'default' }, boardView(true))).toBe('default');
  });

  it('is none for columns without an option, with Color columns off, and outside boards', () => {
    expect(boardColumnColor({}, boardView(true))).toBeNull();
    expect(boardColumnColor({ color: 'blue' }, boardView(false))).toBeNull();
    expect(boardColumnColor({ color: 'blue' }, { layout: 'board' })).toBeNull();
    expect(boardColumnColor({ color: 'blue' }, { layout: 'table', board: board(true) })).toBeNull();
  });

  it('follows the groups of a board grouped by a select', () => {
    const groups = groupRows(rows, { propertyId: 'p-stage' }, ctx, { includeEmptyGroups: true });
    const colors = (on: boolean) =>
      Object.fromEntries(groups.map((g) => [g.label, boardColumnColor(g, boardView(on))]));
    expect(colors(true)).toEqual({
      'No value': null,
      Open: 'blue',
      Done: 'green',
      'On hold': 'default',
    });
    expect(Object.values(colors(false))).toEqual([null, null, null, null]);
  });
});
