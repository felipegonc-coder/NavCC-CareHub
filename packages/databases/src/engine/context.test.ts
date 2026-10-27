import { describe, expect, it, vi } from 'vitest';
import type { ComputedValue, FilterGroup, Id, Row, View } from '../types';
import { QA_ROWS, answer, fakeComputed, makeView, qaQuery } from './fixtures';
import { countRows, runViewQuery } from './query';
import { QUERY_TOO_SLOW, type ArrangedLine, type ComputeContext, type QueryBudget } from './shapes';

const passed: FilterGroup = {
  kind: 'group',
  id: 'root',
  combinator: 'and',
  children: [{ kind: 'condition', id: 'c', propertyId: 'q-pass', op: 'is_checked' }],
};
const score = (r: Row): number => Number(r.values['q-score']);
const index = (r: { id: Id }): number => Number(r.id.slice(3));

describe('formulas and rollups in a query', () => {
  it('works each one out once per row and property, however often the query reads it', () => {
    const calls: string[] = [];
    const input = qaQuery(
      'manager',
      makeView({
        filter: passed,
        sorts: [{ propertyId: 'q-bonus-note', direction: 'asc' }],
        grouping: { propertyId: 'q-pass' },
        calculations: { 'q-pass': 'checked', 'q-bonus': 'sum', 'q-bonus-note': 'count_values' },
        loadLimit: 100,
      }),
    );
    input.computed = (row, id, ctx) => {
      calls.push(`${row.id}/${id}`);
      return fakeComputed(row, id, ctx);
    };
    const out = answer(runViewQuery(input));
    expect(out.count).toBe(QA_ROWS.filter((r) => score(r) >= 70).length);
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls.filter((c) => c.endsWith('/q-pass'))).toHaveLength(QA_ROWS.length);
    expect(out.totals['q-bonus']?.value).toEqual({
      kind: 'number',
      value: QA_ROWS.filter((r) => score(r) >= 70).reduce(
        (a, r) => a + 2 * Number(r.values['q-pay']),
        0,
      ),
    });
  });

  it('gives "This would make a loop." to a result that comes back to itself', () => {
    const rows = answer(runViewQuery(qaQuery('manager', makeView({ loadLimit: 10 })))).rows;
    const loop: ComputedValue = { kind: 'error', message: 'This would make a loop.' };
    expect(rows[0]?.computed['q-buddy-score']).toEqual(loop);
    expect(rows[1]?.computed['q-buddy-score']).toEqual(loop);
    expect(rows[2]?.computed['q-buddy-score']).toEqual({
      kind: 'number',
      value: score(QA_ROWS[3] as Row),
    });
  });

  it('stops working results out once the time budget runs out, and says so', () => {
    let now = 0;
    const budget: QueryBudget = { clock: () => now, deadline: 5 };
    const seen: (QueryBudget | undefined)[] = [];
    const computed = vi.fn((row: Row, id: Id, ctx: ComputeContext): ComputedValue => {
      now += 1;
      seen.push(ctx.budget);
      return fakeComputed(row, id, ctx);
    });
    const out = answer(
      runViewQuery(qaQuery('manager', makeView({ loadLimit: 10 }), { budget, computed })),
    );
    expect(out.timedOut).toBe(true);
    expect(computed).toHaveBeenCalledTimes(6);
    expect(seen.every((b) => b === budget)).toBe(true);
    const slow = out.rows
      .flatMap((r) => Object.values(r.computed))
      .filter((v) => v?.kind === 'error' && v.message === QUERY_TOO_SLOW);
    expect(slow.length).toBeGreaterThan(0);
    const relaxed = answer(
      runViewQuery(
        qaQuery('manager', makeView({ loadLimit: 10 }), {
          budget: { clock: () => 0, deadline: 5 },
        }),
      ),
    );
    expect(relaxed.timedOut).toBe(false);
  });

  it('gives every result as empty when no formula engine is passed', () => {
    const input = qaQuery('manager', makeView({ loadLimit: 10 }));
    delete input.computed;
    const row = answer(runViewQuery(input)).rows[0];
    expect(row?.computed['q-pass']).toEqual({ kind: 'empty' });
  });
});

describe('the same answer whatever order rows come in', () => {
  const shuffled = [...QA_ROWS].sort(
    (a, b) => ((index(a) * 7919) % 241) - ((index(b) * 7919) % 241),
  );
  const views: [string, View][] = [
    [
      'a sorted table',
      makeView({
        sorts: [{ propertyId: 'q-score', direction: 'desc' }],
        calculations: { 'q-score': 'sum' },
      }),
    ],
    [
      'a board with sub-groups',
      makeView({
        layout: 'board',
        grouping: { propertyId: 'q-status' },
        subGrouping: { propertyId: 'q-category' },
        loadLimit: 10,
      }),
    ],
    [
      'a grouped table with loops',
      makeView({ grouping: { propertyId: 'q-pass' }, calculations: { 'q-buddy-score': 'sum' } }),
    ],
    ['a feed', makeView({ layout: 'feed', loadLimit: 25 })],
  ];

  it.each(views)('%s', (_label, view) => {
    expect(shuffled.map((r) => r.id)).not.toEqual(QA_ROWS.map((r) => r.id));
    for (const who of ['manager', 'agent'] as const) {
      const want = runViewQuery(qaQuery(who, view, { search: 'call' }));
      expect(runViewQuery(qaQuery(who, view, { rows: shuffled, search: 'call' }))).toEqual(want);
      expect(countRows(qaQuery(who, view, { rows: shuffled }))).toEqual(
        countRows(qaQuery(who, view)),
      );
    }
  });
});

describe('sub-items', () => {
  const pad = (i: number): string => String(i).padStart(3, '0');
  /** Reviews 1–9 of each ten sit under the tenth, like sub-items. */
  const arrange = (rows: readonly Row[], matches: (row: Row) => boolean): ArrangedLine[] => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const parentOf = (r: Row): Row | undefined =>
      index(r) % 10 ? byId.get(`qa-${pad(index(r) - (index(r) % 10))}`) : undefined;
    const lines: ArrangedLine[] = [];
    for (const r of rows) {
      if (parentOf(r)) continue;
      const kids = rows.filter((k) => parentOf(k) === r && matches(k));
      if (!matches(r) && !kids.length) continue;
      lines.push({
        row: r,
        depth: 0,
        parentId: null,
        childCount: kids.length,
        context: !matches(r),
      });
      for (const k of kids)
        lines.push({ row: k, depth: 1, parentId: r.id, childCount: 0, context: false });
    }
    return lines;
  };
  const view = makeView({ filter: passed, calculations: { 'q-score': 'sum' }, loadLimit: 200 });

  it("shows parents that don't match as context, without counting or totalling them", () => {
    const out = answer(runViewQuery(qaQuery('manager', view, { arrange })));
    const matching = QA_ROWS.filter((r) => score(r) >= 70);
    expect(out.count).toBe(matching.length);
    expect(out.totals['q-score']?.value).toEqual({
      kind: 'number',
      value: matching.reduce((a, r) => a + score(r), 0),
    });
    const context = out.rows.filter((r) => r.context);
    expect(context.length).toBeGreaterThan(0);
    for (const r of context) expect(score(QA_ROWS[index(r)] as Row)).toBeLessThan(70);
    const kid = out.rows.find((r) => r.depth === 1);
    expect(kid).toMatchObject({ childCount: 0, context: false });
    expect(kid?.parentId).toMatch(/0$/);
    const plain = answer(runViewQuery(qaQuery('manager', view))).rows[0];
    expect(plain).not.toHaveProperty('depth');
  });

  it('drops groups left with nothing to show, and is not used on boards with sub-groups', () => {
    const grouped = makeView({ ...view, grouping: { propertyId: 'q-pass' } });
    const out = answer(runViewQuery(qaQuery('manager', grouped, { arrange })));
    expect(out.groups?.map((g) => g.key)).toEqual(['true']);
    const spy = vi.fn(arrange);
    const boardView = makeView({
      layout: 'board',
      grouping: { propertyId: 'q-status' },
      subGrouping: { propertyId: 'q-category' },
    });
    answer(runViewQuery(qaQuery('manager', boardView, { arrange: spy })));
    expect(spy).not.toHaveBeenCalled();
  });
});
