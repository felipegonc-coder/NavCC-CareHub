import { describe, expect, it } from 'vitest';
import type {
  FilterCondition,
  FilterGroup,
  FilterOp,
  FilterValue,
  Id,
  Row,
  View,
  ViewOverride,
} from '../types';
import { HIDDEN_FROM_AGENT, QA_ROWS, agentOpens, answer, makeView, qaQuery } from './fixtures';
import { countRows, runViewQuery } from './query';
import { VIEW_BLOCKED } from './shapes';

const cond = (propertyId: Id, op: FilterOp, value?: FilterValue): FilterCondition => {
  const c: FilterCondition = { kind: 'condition', id: `f-${propertyId}-${op}`, propertyId, op };
  if (value !== undefined) c.value = value;
  return c;
};
const all = (...children: FilterCondition[]): FilterGroup => ({
  kind: 'group',
  id: 'root',
  combinator: 'and',
  children,
});
const BLOCKED = { blocked: VIEW_BLOCKED };
const score = (r: Row): number => Number(r.values['q-score']);
const MINE = QA_ROWS.filter(agentOpens);
const sumOf = (rows: readonly Row[]): number => rows.reduce((a, r) => a + score(r), 0);
const chart = (x: Id, value: Id | null, splitBy: Id | null = null): NonNullable<View['chart']> => ({
  kind: 'bar',
  xPropertyId: x,
  xDateBucket: 'month',
  value: { aggregate: value ? 'sum' : 'count', propertyId: value },
  splitBy,
  order: 'option',
  showValues: true,
  showLegend: true,
  hideEmpty: false,
  stacked: false,
  cumulative: false,
  height: 'm',
});
const boardOf = (patch: Partial<NonNullable<View['board']>>): NonNullable<View['board']> => ({
  cardPreview: { kind: 'none' },
  cardSize: 'm',
  fitImage: false,
  colorColumns: false,
  ...patch,
});

describe('property access (issue #46)', () => {
  const hiddenMore = new Set([...HIDDEN_FROM_AGENT, 'q-date', 'q-recording']);
  const canSee = (id: Id): boolean => !hiddenMore.has(id);
  const uses: [string, Partial<View>][] = [
    ['a filter', { filter: all(cond('q-pay', 'gt', '24')) }],
    ['a sort', { sorts: [{ propertyId: 'q-coach', direction: 'asc' }] }],
    ['the grouping', { grouping: { propertyId: 'q-pay' } }],
    [
      'the sub-grouping',
      {
        layout: 'board',
        grouping: { propertyId: 'q-status' },
        subGrouping: { propertyId: 'q-pay' },
      },
    ],
    ['a calculation', { calculations: { 'q-score': 'sum', 'q-pay': 'average' } }],
    [
      'a color rule condition',
      {
        colorRules: [
          {
            id: 'r',
            filter: all(cond('q-coach', 'is_not_empty')),
            target: { kind: 'row' },
            color: 'red',
          },
        ],
      },
    ],
    [
      'a color rule cell',
      {
        colorRules: [
          {
            id: 'r',
            filter: all(cond('q-score', 'gt', '50')),
            target: { kind: 'property', propertyId: 'q-pay' },
            color: 'red',
          },
        ],
      },
    ],
    ['chart categories', { layout: 'chart', chart: chart('q-pay', null) }],
    ['a chart value', { layout: 'chart', chart: chart('q-category', 'q-pay') }],
    ['a chart split', { layout: 'chart', chart: chart('q-category', null, 'q-pay') }],
    [
      'the calendar date',
      { layout: 'calendar', calendar: { showBy: 'q-date', mode: 'month', showWeekends: true } },
    ],
    [
      'timeline bars',
      {
        layout: 'timeline',
        timeline: {
          showBy: 'q-created',
          endBy: null,
          scale: 'week',
          showTable: false,
          tableProperties: [],
          barPropertyIds: ['q-pay'],
        },
      },
    ],
    [
      'the timeline end date',
      {
        layout: 'timeline',
        timeline: {
          showBy: 'q-created',
          endBy: 'q-date',
          scale: 'week',
          showTable: false,
          tableProperties: [],
        },
      },
    ],
    [
      'the board header calculation',
      {
        layout: 'board',
        grouping: { propertyId: 'q-status' },
        board: boardOf({ headerCalculation: { propertyId: 'q-pay', aggregate: 'sum' } }),
      },
    ],
    [
      'the card preview',
      {
        layout: 'gallery',
        gallery: {
          cardPreview: { kind: 'files', propertyId: 'q-recording' },
          cardSize: 'm',
          fitImage: false,
        },
      },
    ],
    [
      'a sort by a formula that reads it',
      { sorts: [{ propertyId: 'q-bonus-note', direction: 'asc' }] },
    ],
    ['a total of a rollup of hidden job costs', { calculations: { 'q-job-cost': 'sum' } }],
    [
      'a filter on a formula over a related formula that reads it',
      { filter: all(cond('q-job-margin', 'is_not_empty')) },
    ],
  ];

  it.each(uses)(
    'blocks a view when %s uses a hidden property, with nothing else',
    (_label, patch) => {
      const input = { ...qaQuery('agent', makeView(patch)), canSeeProperty: canSee };
      const out = runViewQuery(input);
      expect(out).toStrictEqual(BLOCKED);
      expect(countRows(input)).toStrictEqual(BLOCKED);
      expect(runViewQuery(qaQuery('manager', makeView(patch)))).not.toHaveProperty('blocked');
    },
  );

  it('checks the view after "Changed for you only"', () => {
    const view = makeView({ filter: all(cond('q-pay', 'gt', '24')) });
    expect(runViewQuery(qaQuery('agent', view))).toEqual(BLOCKED);
    const cleared = runViewQuery(qaQuery('agent', view, { override: { filter: null } }));
    expect(answer(cleared).count).toBe(MINE.length);
    const sneaky: ViewOverride = { sorts: [{ propertyId: 'q-bonus', direction: 'desc' }] };
    expect(runViewQuery(qaQuery('agent', makeView(), { override: sneaky }))).toEqual(BLOCKED);
  });

  it('checks again on every query, so access lists changed after saving count at once', () => {
    const hidden = new Set<Id>();
    const view = makeView({ sorts: [{ propertyId: 'q-score', direction: 'desc' }] });
    const override: ViewOverride = { filter: all(cond('q-job-margin', 'is_not_empty')) };
    const input = {
      ...qaQuery('agent', view, { override }),
      canSeeProperty: (id: Id) => !hidden.has(id),
    };
    expect(answer(runViewQuery(input)).count).toBeGreaterThan(0);
    hidden.add('q-score');
    expect(runViewQuery(input)).toEqual(BLOCKED);
    hidden.clear();
    hidden.add('j-cost'); // read by the jobs' Margin, which the override's filter reads
    expect(runViewQuery(input)).toEqual(BLOCKED);
    expect(countRows(input)).toEqual(BLOCKED);
    hidden.clear();
    expect(answer(runViewQuery(input)).count).toBeGreaterThan(0);
  });

  it("a viewer's filter, sort or grouping on a hidden property changes neither their rows nor their order", () => {
    const view = makeView({
      sorts: [{ propertyId: 'q-score', direction: 'desc' }],
      loadLimit: 100,
    });
    const before = runViewQuery(qaQuery('agent', view));
    const overrides: ViewOverride[] = [
      { filter: all(cond('q-pay', 'gt', '24')) },
      { sorts: [{ propertyId: 'q-pay', direction: 'asc' }] },
      {
        sorts: [
          { propertyId: 'q-bonus', direction: 'desc' },
          { propertyId: 'q-score', direction: 'desc' },
        ],
      },
      { grouping: { propertyId: 'q-pay' } },
      { grouping: { propertyId: 'q-bonus-note' } },
    ];
    for (const override of overrides) {
      expect(runViewQuery(qaQuery('agent', view, { override }))).toStrictEqual(BLOCKED);
    }
    // Different hidden values give exactly the same answer: nothing can be learned from them.
    const changed = QA_ROWS.map((r, i) => ({
      ...r,
      values: { ...r.values, 'q-pay': String(90 - (i % 13)), 'q-coach': [{ text: 'zebra' }] },
    }));
    expect(runViewQuery(qaQuery('agent', view, { rows: changed }))).toEqual(before);
    const grouped = makeView({
      grouping: { propertyId: 'q-status' },
      calculations: { 'q-pass': 'checked' },
    });
    expect(
      runViewQuery(qaQuery('agent', grouped, { rows: changed, search: 'zebra call' })),
    ).toEqual(runViewQuery(qaQuery('agent', grouped, { search: 'zebra call' })));
  });

  it('totals and charts leave hidden properties out', () => {
    for (const calculations of [
      { 'q-pay': 'sum' },
      { 'q-bonus': 'max' },
      { 'q-job-cost': 'sum' },
    ] as const) {
      expect(runViewQuery(qaQuery('agent', makeView({ calculations })))).toEqual(BLOCKED);
    }
    expect(
      runViewQuery(
        qaQuery('agent', makeView({ layout: 'chart', chart: chart('q-category', 'q-bonus') })),
      ),
    ).toEqual(BLOCKED);
    const view = makeView({ calculations: { 'q-score': 'sum', 'q-job-hours': 'sum' } });
    const out = answer(runViewQuery(qaQuery('agent', view)));
    expect(Object.keys(out.totals).sort()).toEqual(['q-job-hours', 'q-score']);
    expect(out.totals['q-score']?.value).toEqual({ kind: 'number', value: sumOf(MINE) });
    const pie = answer(
      runViewQuery(
        qaQuery('agent', makeView({ layout: 'chart', chart: chart('q-category', 'q-score') })),
      ),
    );
    for (const row of pie.rows) {
      expect(Object.keys(row.values).some((id) => HIDDEN_FROM_AGENT.has(id))).toBe(false);
    }
  });

  it('search looks only at properties the viewer can see', () => {
    const coached = QA_ROWS.filter((r, i) => i % 7 === 0);
    expect(answer(runViewQuery(qaQuery('manager', makeView(), { search: 'zebra' }))).count).toBe(
      coached.length,
    );
    expect(answer(runViewQuery(qaQuery('agent', makeView(), { search: 'zebra' }))).count).toBe(0);
  });

  it('sends only visible values and results, and lists the visible properties', () => {
    const out = answer(runViewQuery(qaQuery('agent', makeView({ loadLimit: 100 }))));
    expect(out.propertyIds).not.toContain('q-pay');
    expect(out.propertyIds).not.toContain('q-bonus-note');
    expect(out.propertyIds).toContain('q-pass');
    const hiddenResults = ['q-bonus', 'q-bonus-note', 'q-job-cost', 'q-job-margin'];
    for (const row of out.rows) {
      expect(row.values).not.toHaveProperty('q-coach');
      expect(row.values).not.toHaveProperty('q-pay');
      for (const id of hiddenResults) expect(row.computed).not.toHaveProperty(id);
      expect(row.computed['q-pass']).toEqual({
        kind: 'boolean',
        value: Number(row.values['q-score']) >= 70,
      });
    }
    const manager = answer(runViewQuery(qaQuery('manager', makeView())));
    expect(manager.rows[0]?.values['q-pay']).toBe('20');
    expect(manager.rows[0]?.computed['q-bonus-note']).toEqual({ kind: 'text', value: 'Bonus 40' });
  });

  it('never works out hidden formulas, and formulas get rows without hidden values', () => {
    const asked: [Row, Id][] = [];
    const input = qaQuery('agent', makeView({ calculations: { 'q-buddy-score': 'sum' } }));
    const computed = input.computed;
    input.computed = (row, id, ctx) => {
      asked.push([row, id]);
      return computed ? computed(row, id, ctx) : { kind: 'empty' };
    };
    answer(runViewQuery(input));
    expect(asked.length).toBeGreaterThan(0);
    for (const [row, id] of asked) {
      expect(['q-bonus', 'q-bonus-note', 'q-job-cost', 'q-job-margin']).not.toContain(id);
      expect(row.values).not.toHaveProperty('q-pay');
      expect(row.values).not.toHaveProperty('q-coach');
    }
  });

  it('leaves out created and edited details when every property showing them is hidden', () => {
    const input = {
      ...qaQuery('agent', makeView()),
      canSeeProperty: (id: Id) => !['q-created', 'q-id'].includes(id),
    };
    const row = answer(runViewQuery(input)).rows[0];
    expect(row?.createdAt).toBeNull();
    expect(row?.uniqueNumber).toBeNull();
    expect(row?.createdBy).toBe('u-jordan'); // no Created by property hides it
    expect(row?.editedAt).toBe('2026-09-01T14:00:00.000Z');
  });
});
