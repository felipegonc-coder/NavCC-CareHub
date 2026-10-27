import { describe, expect, it } from 'vitest';
import { canConvert, planConversion, type ConversionPlan } from './convert';
import { defaultConfig, newProperty, relationConfig } from './schema';
import type {
  ComputedValue,
  EvalContext,
  Property,
  PropertyType,
  Row,
  SelectOption,
  StatusOption,
  Viewer,
} from './types';

const viewer: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00.000Z'),
};
const names: Record<string, string> = { 'u-avery': 'Avery Lin', 'u-jordan': 'Jordan Park' };
const titles: Record<string, string> = { 'r-leak': 'Fix kitchen leak' };
const ctx: EvalContext = {
  properties: [],
  viewer,
  userName: (id) => names[id],
  rowTitle: (id) => titles[id],
};
const users: Record<string, string> = { 'avery lin': 'u-avery', 'jordan park': 'u-jordan' };
const findUser = (text: string): string | undefined => users[text.toLowerCase()];

const row = (id: string, values: Row['values'] = {}, uniqueNumber: number | null = null): Row => ({
  id,
  title: 'Call back Blue Pine Plumbing',
  values,
  createdAt: '2026-10-26T15:00:00.000Z',
  createdBy: 'u-avery',
  editedAt: '2026-10-26T15:00:00.000Z',
  editedBy: 'u-avery',
  uniqueNumber,
});
/** One row per text ("" leaves the row empty): r0, r1, … */
const textRows = (prop: Property, texts: readonly string[]): Row[] =>
  texts.map((t, i) => row(`r${i}`, t ? { [prop.id]: [{ text: t }] } : {}));
const valuesOf = (plan: ConversionPlan): Record<string, unknown> => Object.fromEntries(plan.values);
const optionsOf = (plan: ConversionPlan): StatusOption[] =>
  'options' in plan.config ? (plan.config.options as StatusOption[]) : [];
const opt = (id: string, name: string, color: SelectOption['color']): SelectOption => ({
  id,
  name,
  color,
});

const notes = newProperty('Notes', defaultConfig('text'));

describe('canConvert', () => {
  const cases: [PropertyType, PropertyType, boolean][] = [
    ['number', 'text', true],
    ['date', 'text', true],
    ['person', 'text', true],
    ['relation', 'text', true],
    ['formula', 'text', true],
    ['rollup', 'text', true],
    ['unique_id', 'text', true],
    ['text', 'number', true],
    ['text', 'date', true],
    ['text', 'checkbox', true],
    ['text', 'url', true],
    ['text', 'email', true],
    ['text', 'phone', true],
    ['text', 'select', true],
    ['text', 'multi_select', true],
    ['text', 'status', true],
    ['text', 'person', true],
    ['select', 'multi_select', true],
    ['select', 'status', true],
    ['multi_select', 'select', true],
    ['status', 'multi_select', true],
    ['unique_id', 'number', true],
    ['title', 'text', false],
    ['text', 'title', false],
    ['text', 'text', false],
    ['text', 'files', false],
    ['text', 'relation', false],
    ['text', 'checklist', false],
    ['text', 'formula', false],
    ['number', 'unique_id', false],
    ['text', 'button', false],
    ['number', 'select', false],
    ['checkbox', 'number', false],
    ['date', 'number', false],
    ['select', 'person', false],
  ];
  it.each(cases)('%s → %s: %s', (from: PropertyType, to: PropertyType, want: boolean) => {
    expect(canConvert(from, to)).toBe(want);
  });
});

describe('planConversion', () => {
  it("throws for a change that isn't offered", () => {
    expect(() => planConversion(notes, defaultConfig('files'), [], ctx)).toThrow(
      "A text property can't change to files.",
    );
  });

  describe('to Text', () => {
    it('writes values as they are exported', () => {
      const due = newProperty('Due', { ...defaultConfig('date'), format: 'relative' });
      const today = { start: '2026-10-26', end: null, hasTime: false };
      const plan = planConversion(
        due,
        defaultConfig('text'),
        [row('r0', { [due.id]: today })],
        ctx,
      );
      expect(plan.config).toEqual({ type: 'text' });
      expect(valuesOf(plan)).toEqual({ r0: [{ text: 'Oct 26, 2026' }] });
      expect(plan.cleared).toBe(0);
    });
    it('writes numbers, options, people, checkboxes and IDs as text', () => {
      const money = newProperty('Amount', {
        ...defaultConfig('number'),
        format: 'currency',
        decimals: 2,
      });
      const tags = newProperty('Tags', {
        type: 'multi_select',
        options: [opt('o-plumb', 'Plumbing', 'blue'), opt('o-hvac', 'HVAC', 'green')],
      });
      const owners = newProperty('Owners', defaultConfig('person'));
      const done = newProperty('Done', defaultConfig('checkbox'));
      const id = newProperty('ID', { type: 'unique_id', prefix: 'QA' });
      const r = row(
        'r0',
        {
          [money.id]: '1234.5',
          [tags.id]: ['o-hvac', 'o-plumb'],
          [owners.id]: ['u-avery', 'u-jordan'],
          [done.id]: true,
        },
        12,
      );
      const text = (prop: Property, rows: Row[] = [r]): unknown =>
        planConversion(prop, defaultConfig('text'), rows, ctx).values.get('r0');
      expect(text(money)).toEqual([{ text: '$1,234.50' }]);
      expect(text(tags)).toEqual([{ text: 'HVAC, Plumbing' }]);
      expect(text(owners)).toEqual([{ text: 'Avery Lin, Jordan Park' }]);
      expect(text(done)).toEqual([{ text: 'Yes' }]);
      expect(text(done, [row('r0')])).toEqual([{ text: 'No' }]);
      expect(text(id)).toEqual([{ text: 'QA-12' }]);
    });
    it('keeps formula and rollup results as they show', () => {
      const total = newProperty('Total', defaultConfig('formula'));
      const results: Record<string, ComputedValue> = {
        r0: { kind: 'number', value: 3 },
        r1: { kind: 'empty' },
      };
      const computed = (r: Row): ComputedValue => results[r.id] ?? { kind: 'empty' };
      const plan = planConversion(total, defaultConfig('text'), [row('r0'), row('r1')], {
        ...ctx,
        computed,
      });
      expect(valuesOf(plan)).toEqual({ r0: [{ text: '3' }] });
      expect(plan.cleared).toBe(0);
    });
    it("writes related rows' titles and leaves out rows you can't open", () => {
      const jobs = newProperty('Jobs', relationConfig('db-jobs'));
      const rows = [
        row('r0', { [jobs.id]: ['r-leak', 'r-hidden'] }),
        row('r1', { [jobs.id]: ['r-hidden'] }),
        row('r2'),
      ];
      const plan = planConversion(jobs, defaultConfig('text'), rows, ctx);
      expect(valuesOf(plan)).toEqual({ r0: [{ text: 'Fix kitchen leak' }] });
      expect(plan.cleared).toBe(1);
    });
    it('cuts values to 10,000 characters without splitting an emoji', () => {
      const summary = newProperty('Summary', defaultConfig('formula'));
      const long = `${'a'.repeat(9_999)}😀b`;
      const plan = planConversion(summary, defaultConfig('text'), [row('r0')], {
        ...ctx,
        computed: () => ({ kind: 'text', value: long }),
      });
      expect(valuesOf(plan)).toEqual({ r0: [{ text: 'a'.repeat(9_999) }] });
    });
  });

  describe('from Text', () => {
    it('reads numbers as if typed', () => {
      const rows = textRows(notes, ['1,234.50', '$12', 'about ten', '45%', '']);
      const plan = planConversion(notes, defaultConfig('number'), rows, ctx);
      expect(valuesOf(plan)).toEqual({ r0: '1234.5', r1: '12', r3: '0.45' });
      expect(plan.cleared).toBe(1);
    });
    it('reads 45 as 45% for a Percent property', () => {
      const plan = planConversion(
        notes,
        { ...defaultConfig('number'), format: 'percent' },
        textRows(notes, ['45']),
        ctx,
      );
      expect(valuesOf(plan)).toEqual({ r0: '0.45' });
    });
    it("reads dates in the viewer's time zone and the new format", () => {
      const rows = textRows(notes, ['Oct 26, 2026 3:30 PM', 'Oct 26, 2026 → Oct 28, 2026', 'soon']);
      const plan = planConversion(notes, defaultConfig('date'), rows, ctx);
      expect(valuesOf(plan)).toEqual({
        r0: { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true },
        r1: { start: '2026-10-26', end: '2026-10-28', hasTime: false },
      });
      expect(plan.cleared).toBe(1);
      const dayFirst = planConversion(
        notes,
        { ...defaultConfig('date'), format: 'dmy' },
        textRows(notes, ['03/04/2026']),
        ctx,
      );
      expect(valuesOf(dayFirst)).toEqual({
        r0: { start: '2026-04-03', end: null, hasTime: false },
      });
    });
    it('ticks checkboxes for the checked words and clears unknown text', () => {
      const words = ['yes', 'No', 'maybe', '', 'Checked', 'unchecked', 'FALSE', '0', '✓'];
      const plan = planConversion(notes, defaultConfig('checkbox'), textRows(notes, words), ctx);
      expect(valuesOf(plan)).toEqual({ r0: true, r4: true, r8: true });
      expect(plan.cleared).toBe(1);
    });
    it('reads links, emails and phone numbers', () => {
      const link = planConversion(
        notes,
        defaultConfig('url'),
        textRows(notes, ['bluepine.example', 'javascript:alert(1)']),
        ctx,
      );
      expect(valuesOf(link)).toEqual({ r0: 'https://bluepine.example' });
      expect(link.cleared).toBe(1);
      const mail = planConversion(
        notes,
        defaultConfig('email'),
        textRows(notes, ['avery@bluepine.example', 'Avery']),
        ctx,
      );
      expect(valuesOf(mail)).toEqual({ r0: 'avery@bluepine.example' });
      expect(mail.cleared).toBe(1);
      const tel = planConversion(
        notes,
        defaultConfig('phone'),
        textRows(notes, ['+1 (303) 555-0100', 'call me']),
        ctx,
      );
      expect(valuesOf(tel)).toEqual({ r0: '+1 (303) 555-0100' });
      expect(tel.cleared).toBe(1);
    });
    it('makes Select options from the first part of each value', () => {
      const rows = textRows(notes, ['Plumbing, HVAC', 'plumbing', 'HVAC', '', 'a'.repeat(101)]);
      const plan = planConversion(notes, defaultConfig('select'), rows, ctx);
      const [plumbing, hvac] = optionsOf(plan);
      expect(optionsOf(plan)).toEqual([
        { id: plumbing?.id, name: 'Plumbing', color: 'gray' },
        { id: hvac?.id, name: 'HVAC', color: 'brown' },
      ]);
      expect(valuesOf(plan)).toEqual({ r0: plumbing?.id, r1: plumbing?.id, r2: hvac?.id });
      expect(plan.cleared).toBe(1);
    });
    it('splits Multi-select values on commas', () => {
      const rows = textRows(notes, ['Plumbing, HVAC, hvac', 'HVAC']);
      const plan = planConversion(notes, defaultConfig('multi_select'), rows, ctx);
      const [plumbing, hvac] = optionsOf(plan);
      expect(optionsOf(plan).map((o) => o.name)).toEqual(['Plumbing', 'HVAC']);
      expect(valuesOf(plan)).toEqual({ r0: [plumbing?.id, hvac?.id], r1: [hvac?.id] });
    });
    it('matches Status options by name and puts new ones in To-do', () => {
      const config = defaultConfig('status');
      const rows = textRows(notes, ['done', 'Waiting on parts', 'Plumbing, HVAC']);
      const plan = planConversion(notes, config, rows, ctx);
      const options = optionsOf(plan);
      expect(options.slice(0, 3)).toEqual(config.options);
      expect(options.slice(3).map((o) => [o.name, o.group, o.color])).toEqual([
        ['Waiting on parts', 'todo', 'blue'],
        ['Plumbing', 'todo', 'purple'],
      ]);
      expect(plan.config).toMatchObject({
        type: 'status',
        defaultOptionId: config.defaultOptionId,
      });
      expect(valuesOf(plan)).toEqual({
        r0: config.options[2]?.id,
        r1: options[3]?.id,
        r2: options[4]?.id,
      });
    });
    it('finds people by exact name and keeps the ones it finds', () => {
      const rows = textRows(notes, ['Avery Lin, Jordan Park', 'Avery Lin, Sam Doe', 'Sam Doe', '']);
      const plan = planConversion(notes, defaultConfig('person'), rows, ctx, { findUser });
      expect(valuesOf(plan)).toEqual({ r0: ['u-avery', 'u-jordan'], r1: ['u-avery'] });
      expect(plan.cleared).toBe(1);
    });
    it('keeps the first person for a one-person property', () => {
      const single = { ...defaultConfig('person'), single: true };
      const rows = textRows(notes, ['Avery Lin, Jordan Park']);
      const plan = planConversion(notes, single, rows, ctx, { findUser });
      expect(valuesOf(plan)).toEqual({ r0: ['u-avery'] });
    });
    it('clears people when nobody can be looked up', () => {
      const plan = planConversion(
        notes,
        defaultConfig('person'),
        textRows(notes, ['Avery Lin']),
        ctx,
      );
      expect(plan.values.size).toBe(0);
      expect(plan.cleared).toBe(1);
    });
  });

  describe('between Select, Multi-select and Status', () => {
    const tagOptions = [
      opt('o-plumb', 'Plumbing', 'blue'),
      { ...opt('o-hvac', 'HVAC', 'green'), description: 'Heating and cooling' },
      opt('o-unused', 'Unused', 'red'),
    ];
    const tags = newProperty('Tags', { type: 'multi_select', options: tagOptions });
    const rows = [
      row('r0', { [tags.id]: ['o-hvac', 'o-plumb'] }),
      row('r1'),
      row('r2', { [tags.id]: ['o-plumb'] }),
      row('r3', { [tags.id]: ['o-gone'] }),
    ];
    it('carries every option over and keeps the first value', () => {
      const plan = planConversion(tags, defaultConfig('select'), rows, ctx);
      expect(plan.config).toEqual({ type: 'select', options: tagOptions });
      expect(valuesOf(plan)).toEqual({ r0: 'o-hvac', r2: 'o-plumb' });
      expect(plan.cleared).toBe(1);
    });
    it('keeps a Select value as a one-item Multi-select', () => {
      const trade = newProperty('Trade', { type: 'select', options: tagOptions });
      const plan = planConversion(
        trade,
        defaultConfig('multi_select'),
        [row('r0', { [trade.id]: 'o-hvac' }), row('r1')],
        ctx,
      );
      expect(plan.config).toEqual({ type: 'multi_select', options: tagOptions });
      expect(valuesOf(plan)).toEqual({ r0: ['o-hvac'] });
    });
    it('adds the options to Status in To-do, matching names', () => {
      const config = defaultConfig('status');
      const withDone = {
        ...tags,
        config: { ...tags.config, options: [...tagOptions, opt('o-done', 'done', 'pink')] },
      };
      const plan = planConversion(
        withDone,
        config,
        [...rows, row('r4', { [withDone.id]: ['o-done'] })],
        ctx,
      );
      expect(optionsOf(plan)).toEqual([
        ...config.options,
        { id: 'o-plumb', name: 'Plumbing', color: 'blue', group: 'todo' },
        {
          id: 'o-hvac',
          name: 'HVAC',
          color: 'green',
          group: 'todo',
          description: 'Heating and cooling',
        },
        { id: 'o-unused', name: 'Unused', color: 'red', group: 'todo' },
      ]);
      expect(valuesOf(plan)).toEqual({ r0: 'o-hvac', r2: 'o-plumb', r4: config.options[2]?.id });
    });
    it('drops Status groups for Select', () => {
      const config = defaultConfig('status');
      const status = newProperty('Status', config);
      const [todo, , complete] = config.options;
      const plan = planConversion(
        status,
        defaultConfig('select'),
        [row('r0', { [status.id]: complete?.id })],
        ctx,
      );
      expect(optionsOf(plan)).toEqual(
        config.options.map(({ id, name, color }) => ({ id, name, color })),
      );
      expect(valuesOf(plan)).toEqual({ r0: complete?.id });
      expect(todo?.group).toBe('todo');
    });
  });

  describe('ID to Number', () => {
    it('keeps the numbers', () => {
      const id = newProperty('ID', { type: 'unique_id', prefix: 'QA' });
      const plan = planConversion(id, defaultConfig('number'), [row('r0', {}, 12), row('r1')], ctx);
      expect(plan.config).toEqual(defaultConfig('number'));
      expect(valuesOf(plan)).toEqual({ r0: '12' });
      expect(plan.cleared).toBe(0);
    });
  });
});
