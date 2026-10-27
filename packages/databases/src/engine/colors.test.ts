import { describe, expect, it } from 'vitest';
import type { ColorRule, FilterCondition, Id, Row, View } from '../types';
import { QA_ROWS, agentOpens, answer, fakeComputed, makeView, qaQuery } from './fixtures';
import { runViewQuery } from './query';
import { VIEW_BLOCKED, type QueryRow } from './shapes';

const rule = (
  id: string,
  condition: Omit<FilterCondition, 'kind' | 'id'>,
  color: ColorRule['color'],
  cell?: Id,
): ColorRule => ({
  id,
  filter: {
    kind: 'group',
    id: `g-${id}`,
    combinator: 'and',
    children: [{ kind: 'condition', id: `c-${id}`, ...condition }],
  },
  target: cell ? { kind: 'property', propertyId: cell } : { kind: 'row' },
  color,
});
const RULES: ColorRule[] = [
  rule('top', { propertyId: 'q-score', op: 'gte', value: '90' }, 'green'),
  rule('done', { propertyId: 'q-status', op: 'is', value: ['s-done'] }, 'blue', 'q-status'),
  rule('fair', { propertyId: 'q-score', op: 'gte', value: '50' }, 'yellow'),
  rule('pass', { propertyId: 'q-pass', op: 'is_checked' }, 'purple', 'q-score'),
  rule('late', { propertyId: 'q-score', op: 'gte', value: '0' }, 'red', 'q-status'),
];
const source = new Map(QA_ROWS.map((r) => [r.id, r]));
/** The colors worked out by hand from the rules above. */
function expected(id: Id): QueryRow['color'] {
  const row = source.get(id) as Row;
  const score = Number(row.values['q-score']);
  const cells: QueryRow['color']['cells'] = {};
  cells['q-status'] = row.values['q-status'] === 's-done' ? 'blue' : 'red';
  if (score >= 70) cells['q-score'] = 'purple';
  return { row: score >= 90 ? 'green' : score >= 50 ? 'yellow' : null, cells };
}
const view = (patch: Partial<View> = {}): View =>
  makeView({ colorRules: RULES, loadLimit: 100, ...patch });

describe('conditional color', () => {
  it('colors rows and cells: the first matching row rule, and each cell its first matching rule', () => {
    for (const who of ['manager', 'agent'] as const) {
      const out = answer(runViewQuery(qaQuery(who, view())));
      expect(out.rows).toHaveLength(100);
      for (const r of out.rows) expect(r.color).toEqual(expected(r.id));
    }
  });

  it('colors the rows of groups and board sub-groups the same way', () => {
    const board = view({
      layout: 'board',
      grouping: { propertyId: 'q-status' },
      subGrouping: { propertyId: 'q-category' },
    });
    const out = answer(runViewQuery(qaQuery('agent', board)));
    const rows = (out.groups ?? []).flatMap((g) => (g.subGroups ?? []).flatMap((s) => s.rows));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(agentOpens(source.get(r.id) as Row)).toBe(true);
      expect(r.color).toEqual(expected(r.id));
    }
  });

  it("blocks a view whose rules use a property the viewer can't see, even through formulas and relations", () => {
    for (const hidden of [
      rule('h1', { propertyId: 'q-coach', op: 'is_not_empty' }, 'red'),
      rule('h2', { propertyId: 'q-bonus', op: 'gt', value: '50' }, 'red'),
      rule('h3', { propertyId: 'q-score', op: 'gt', value: '50' }, 'red', 'q-job-margin'),
      rule('h4', { propertyId: 'q-job-cost', op: 'gt', value: '0' }, 'red', 'q-score'),
    ]) {
      const colorRules = [...RULES, hidden];
      expect(runViewQuery(qaQuery('agent', view({ colorRules })))).toEqual({
        blocked: VIEW_BLOCKED,
      });
      const manager = answer(runViewQuery(qaQuery('manager', view({ colorRules }))));
      expect(manager.rows[0]?.color).toBeDefined();
    }
  });

  it('passes Default through like any color: it keeps that row or cell plain and stops later rules', () => {
    const colorRules = [
      rule('plain', { propertyId: 'q-score', op: 'gte', value: '95' }, 'default'),
      rule(
        'plain-cell',
        { propertyId: 'q-status', op: 'is', value: ['s-todo'] },
        'default',
        'q-status',
      ),
      ...RULES,
    ];
    const out = answer(runViewQuery(qaQuery('manager', view({ colorRules, loadLimit: 200 }))));
    let plain = 0;
    for (const r of out.rows) {
      const want = expected(r.id);
      const row = source.get(r.id) as Row;
      if (Number(row.values['q-score']) >= 95) want.row = 'default';
      if (row.values['q-status'] === 's-todo') want.cells['q-status'] = 'default';
      if (want.row === 'default') plain++;
      expect(r.color).toEqual(want);
    }
    expect(plain).toBeGreaterThan(0);
  });

  it('skips rules on deleted properties and rules with no value chosen yet', () => {
    const colorRules = [
      rule('gone', { propertyId: 'q-gone', op: 'is_not_empty' }, 'pink'),
      rule('unset', { propertyId: 'q-score', op: 'gte' }, 'pink'),
      ...RULES,
    ];
    const out = answer(runViewQuery(qaQuery('agent', view({ colorRules }))));
    for (const r of out.rows) expect(r.color).toEqual(expected(r.id));
  });

  it('gives no colors where the layout shows none, or without rules', () => {
    const patches: Partial<View>[] = [{ layout: 'feed' }, { layout: 'chart' }, { colorRules: [] }];
    for (const patch of patches) {
      const out = answer(runViewQuery(qaQuery('manager', view(patch))));
      for (const r of out.rows) expect(r.color).toEqual({ row: null, cells: {} });
    }
  });

  it('reads formula results through the query, once per row and property', () => {
    const calls: string[] = [];
    const input = qaQuery(
      'manager',
      view({ sorts: [{ propertyId: 'q-pass', direction: 'desc' }] }),
    );
    input.computed = (row, id, ctx) => {
      calls.push(`${row.id}/${id}`);
      return fakeComputed(row, id, ctx);
    };
    const out = answer(runViewQuery(input));
    for (const r of out.rows) expect(r.color).toEqual(expected(r.id));
    expect(new Set(calls).size).toBe(calls.length);
  });
});
