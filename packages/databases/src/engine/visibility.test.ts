import { describe, expect, it } from 'vitest';
import type { FilterCondition, FilterGroup, FilterNode, Id, View } from '../types';
import { HIDDEN_FROM_AGENT, JOB_PROPS, QA_PROPS, dependsOn, makeView, prop } from './fixtures';
import {
  applyOverride,
  usesHiddenProperty,
  viewPropertyIds,
  visiblePropertyIds,
} from './visibility';

const cond = (propertyId: Id): FilterCondition => ({
  kind: 'condition',
  id: `f-${propertyId}`,
  propertyId,
  op: 'is_not_empty',
});
const all = (...children: FilterNode[]): FilterGroup => ({
  kind: 'group',
  id: `g-${children.length}`,
  combinator: 'and',
  children,
});
const agentSees = (id: Id): boolean => !HIDDEN_FROM_AGENT.has(id);
const everyone = (): boolean => true;
const sorted = (ids: Iterable<Id>): Id[] => [...ids].sort();

describe('applyOverride', () => {
  const view = makeView({
    filter: all(cond('q-score')),
    sorts: [{ propertyId: 'q-score', direction: 'desc' }],
    layout: 'board',
    grouping: { propertyId: 'q-status' },
    subGrouping: { propertyId: 'q-category' },
    calculations: { 'q-score': 'sum' },
  });

  it('gives the saved view itself when there is no override', () => {
    expect(applyOverride(view)).toBe(view);
    expect(applyOverride(view, null)).toBe(view);
  });

  it('replaces the filter, sorts and grouping it gives and keeps the rest', () => {
    const out = applyOverride(view, {
      filter: all(cond('q-notes')),
      sorts: [],
      grouping: { propertyId: 'q-category' },
    });
    expect(out.filter).toEqual(all(cond('q-notes')));
    expect(out.sorts).toEqual([]);
    expect(out.grouping).toEqual({ propertyId: 'q-category' });
    expect(out.subGrouping).toEqual({ propertyId: 'q-category' });
    expect(out.calculations).toEqual({ 'q-score': 'sum' });
    expect(view.sorts).toHaveLength(1);
  });

  it('null clears the filter and the grouping, and with it the sub-grouping', () => {
    const out = applyOverride(view, { filter: null, grouping: null });
    expect(out.filter).toBeNull();
    expect(out.grouping).toBeNull();
    expect(out.subGrouping).toBeNull();
    expect(out.sorts).toEqual(view.sorts);
  });
});

describe('viewPropertyIds', () => {
  const board = { cardSize: 'm', fitImage: false, colorColumns: false } as const;
  const cases: [string, Partial<View>, Id[]][] = [
    [
      'filter conditions at any depth',
      { filter: all(cond('a'), all(cond('b'), all(cond('c')))) },
      ['a', 'b', 'c'],
    ],
    [
      'sorts',
      {
        sorts: [
          { propertyId: 'a', direction: 'asc' },
          { propertyId: 'b', direction: 'desc' },
        ],
      },
      ['a', 'b'],
    ],
    [
      'grouping and sub-grouping',
      { grouping: { propertyId: 'a' }, subGrouping: { propertyId: 'b' } },
      ['a', 'b'],
    ],
    [
      'calculations other than None',
      { calculations: { a: 'sum', b: 'none', c: 'count_all' } },
      ['a', 'c'],
    ],
    [
      'color rules: conditions and target cells',
      {
        colorRules: [
          { id: 'r1', filter: all(cond('a')), target: { kind: 'row' }, color: 'red' },
          {
            id: 'r2',
            filter: all(cond('b')),
            target: { kind: 'property', propertyId: 'c' },
            color: 'blue',
          },
        ],
      },
      ['a', 'b', 'c'],
    ],
    [
      'board card preview Files and header calculation',
      {
        board: {
          ...board,
          cardPreview: { kind: 'files', propertyId: 'a' },
          headerCalculation: { propertyId: 'b', aggregate: 'sum' },
        },
      },
      ['a', 'b'],
    ],
    [
      'gallery card preview Files',
      { gallery: { ...board, cardPreview: { kind: 'files', propertyId: 'a' } } },
      ['a'],
    ],
    ['calendar date', { calendar: { showBy: 'a', mode: 'month', showWeekends: true } }, ['a']],
    [
      'timeline dates and bar properties',
      {
        timeline: {
          showBy: 'a',
          endBy: 'b',
          scale: 'week',
          showTable: true,
          tableProperties: [{ propertyId: 'z', visible: true }],
          barPropertyIds: ['c'],
        },
      },
      ['a', 'b', 'c'],
    ],
    [
      'chart categories, value and split',
      {
        chart: {
          kind: 'bar',
          xPropertyId: 'a',
          xDateBucket: 'month',
          value: { aggregate: 'sum', propertyId: 'b' },
          splitBy: 'c',
          order: 'option',
          showValues: true,
          showLegend: true,
          hideEmpty: false,
          stacked: false,
          cumulative: false,
          height: 'm',
        },
      },
      ['a', 'b', 'c'],
    ],
  ];

  it.each(cases)('lists %s', (_label, patch, expected) => {
    expect(sorted(viewPropertyIds(makeView(patch)))).toEqual(expected);
  });

  it('lists each property once and leaves visible columns out', () => {
    const view = makeView({
      filter: all(cond('a'), cond('a')),
      sorts: [{ propertyId: 'a', direction: 'asc' }],
      calculations: { a: 'sum' },
      properties: [{ propertyId: 'z', visible: true }],
      board: {
        ...board,
        cardPreview: { kind: 'cover' },
        headerCalculation: { propertyId: null, aggregate: 'count_all' },
      },
    });
    expect(viewPropertyIds(view)).toEqual(['a']);
    expect(viewPropertyIds(makeView())).toEqual([]);
  });
});

describe('visiblePropertyIds', () => {
  const visible = (canSee: (id: Id) => boolean) => visiblePropertyIds(QA_PROPS, canSee, dependsOn);

  it('lets someone who can see everything see everything', () => {
    expect(sorted(visible(everyone))).toEqual(sorted(QA_PROPS.map((p) => p.id)));
  });

  it('always shows Name, whatever its see list says', () => {
    expect(visible(() => false)).toEqual(new Set(['q-name']));
  });

  it('hides a formula that reads a hidden property, directly or through another formula', () => {
    const seen = visible(agentSees);
    expect(seen.has('q-pay')).toBe(false);
    expect(seen.has('q-bonus')).toBe(false);
    expect(seen.has('q-bonus-note')).toBe(false);
    expect(seen.has('q-pass')).toBe(true);
  });

  it('follows chains across relations: rollups and formulas over a hidden property elsewhere', () => {
    const seen = visible(agentSees);
    expect(seen.has('q-job-cost')).toBe(false); // rollup of the jobs' hidden Cost
    expect(seen.has('q-job-margin')).toBe(false); // reads the jobs' Margin, which reads Cost
    expect(seen.has('q-job-hours')).toBe(true);
    expect(seen.has('q-job')).toBe(true);
  });

  it('hides a rollup when its relation is hidden, and a rollup of a rollup that reads hidden', () => {
    const props = [
      ...QA_PROPS,
      prop('q-margin-roll', 'Margin roll', {
        type: 'rollup',
        relationPropertyId: 'q-job',
        targetPropertyId: 'j-margin',
        aggregate: 'sum',
        number: null,
      }),
    ];
    const seen = visiblePropertyIds(props, agentSees, dependsOn);
    expect(seen.has('q-margin-roll')).toBe(false);
    const noJobs = visiblePropertyIds(props, (id) => id !== 'q-job', dependsOn);
    expect(noJobs.has('q-job-hours')).toBe(false);
    expect(noJobs.has('q-jobs')).toBe(false);
    expect(noJobs.has('q-margin-roll')).toBe(false);
    expect(noJobs.has('q-score')).toBe(true);
  });

  it('keeps a formula that reads itself through a relation while all of it is visible', () => {
    expect(visible(agentSees).has('q-buddy-score')).toBe(true);
    expect(visible((id) => id !== 'q-buddy').has('q-buddy-score')).toBe(false);
    expect(visible((id) => id !== 'q-score').has('q-buddy-score')).toBe(false);
  });

  it('asks again every time, so a see list changed later counts at once', () => {
    const hidden = new Set<Id>();
    const canSee = (id: Id): boolean => !hidden.has(id);
    expect(visible(canSee).has('q-pass')).toBe(true);
    hidden.add('q-score');
    expect(visible(canSee).has('q-pass')).toBe(false);
    hidden.clear();
    expect(visible(canSee).has('q-pass')).toBe(true);
  });

  it('only follows what formulas and rollups read, and asks about each property once', () => {
    let asked = 0;
    const canSee = (id: Id): boolean => {
      asked++;
      return agentSees(id);
    };
    const seen = visiblePropertyIds(JOB_PROPS, canSee, (id) =>
      id === 'j-hours' ? ['j-cost'] : dependsOn(id),
    );
    expect(seen.has('j-hours')).toBe(true);
    expect(seen.has('j-margin')).toBe(false);
    expect(asked).toBe(JOB_PROPS.length - 1);
  });
});

describe('usesHiddenProperty', () => {
  const seen = visiblePropertyIds(QA_PROPS, agentSees, dependsOn);
  it.each([
    ['a filter on Pay rate', makeView({ filter: all(cond('q-pay')) }), true],
    [
      'a sort by a formula that reads it',
      makeView({ sorts: [{ propertyId: 'q-bonus', direction: 'asc' }] }),
      true,
    ],
    [
      'totals of a rollup of hidden job costs',
      makeView({ calculations: { 'q-job-cost': 'sum' } }),
      true,
    ],
    [
      'visible properties only',
      makeView({ filter: all(cond('q-score')), calculations: { 'q-pass': 'checked' } }),
      false,
    ],
    [
      'a deleted property',
      makeView({ sorts: [{ propertyId: 'q-gone', direction: 'asc' }] }),
      false,
    ],
  ])('%s: %s', (_label, view, expected) => {
    expect(usesHiddenProperty(view, QA_PROPS, seen)).toBe(expected);
  });
});
