import { describe, expect, it } from 'vitest';
import type {
  FilterCondition,
  FilterGroup,
  FilterOp,
  FilterValue,
  Id,
  Row,
  ViewOverride,
} from '../types';
import { QA_ROWS, agentOpens, answer, idsIn, makeView, qaQuery } from './fixtures';
import { runViewQuery } from './query';
import { HIDDEN_ROW_ID } from './shapes';

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
const score = (r: Row): number => Number(r.values['q-score']);
const index = (r: Row): number => Number(r.id.slice(3));
const ids = (rows: readonly { id: Id }[]): Id[] => rows.map((r) => r.id);
const MINE = QA_ROWS.filter(agentOpens);
const sumOf = (rows: readonly Row[]): number => rows.reduce((a, r) => a + score(r), 0);
describe('row access', () => {
  it('only rows the viewer can open count, total, group and turn up in search', () => {
    const view = makeView({
      grouping: { propertyId: 'q-status' },
      calculations: { 'q-score': 'sum' },
    });
    const out = answer(runViewQuery(qaQuery('agent', view)));
    expect(out.count).toBe(MINE.length);
    expect(out.totals['q-score']?.value).toEqual({ kind: 'number', value: sumOf(MINE) });
    for (const g of out.groups ?? []) {
      const inGroup = MINE.filter((r) => r.values['q-status'] === g.key);
      expect(g.count).toBe(inGroup.length);
      expect(g.totals['q-score']?.value).toEqual(
        inGroup.length ? { kind: 'number', value: sumOf(inGroup) } : { kind: 'empty' },
      );
      for (const r of g.rows) expect(r.values['q-agent']).toEqual(['u-jordan']);
    }
    expect(answer(runViewQuery(qaQuery('manager', makeView(), { search: 'invoice' }))).count).toBe(
      24,
    );
    expect(answer(runViewQuery(qaQuery('agent', makeView(), { search: 'invoice' }))).count).toBe(0);
    expect(answer(runViewQuery(qaQuery('agent', makeView(), { search: 'routine' }))).count).toBe(
      MINE.length,
    );
  });

  it('links only to rows the viewer can open, counting the others', () => {
    const out = answer(runViewQuery(qaQuery('agent', makeView({ loadLimit: 10 }))));
    const first = out.rows[0];
    expect(first?.id).toBe('qa-001');
    expect(first?.values['q-job']).toEqual(['job-001']); // job-004 has no technician
    expect(first?.hiddenLinks).toEqual({ 'q-job': 1, 'q-buddy': 1 });
    expect(first?.computed['q-jobs']).toEqual({
      kind: 'list',
      value: [
        { kind: 'page', value: HIDDEN_ROW_ID },
        { kind: 'page', value: 'job-001' },
      ],
    });
    expect(first?.computed['q-job-hours']).toEqual({ kind: 'number', value: 2 });
    expect(first?.computed['q-buddy-score']).toEqual({ kind: 'number', value: 37 });
    expect(out.rowTitles['job-001']).toBe('Replace water heater #2');
    expect(out.rowTitles).not.toHaveProperty('qa-000');
    expect(out.rowTitles).not.toHaveProperty('job-004');
    const manager = answer(runViewQuery(qaQuery('manager', makeView({ loadLimit: 10 }))));
    expect(manager.rows[1]?.values['q-job']).toEqual(['job-004', 'job-001']);
    expect(manager.rows[1]?.computed['q-job-hours']).toEqual({ kind: 'number', value: 7 });
    expect(manager.rowTitles['job-004']).toBe('Fix leaking tap #5');
    expect(manager.rowTitles['qa-000']).toBe('Call review 1');
  });

  it('links that stay are listed with their titles', () => {
    const out = answer(runViewQuery(qaQuery('agent', makeView({ loadLimit: 100 }))));
    const linked = out.rows.filter((r) => r.values['q-job']);
    expect(linked.length).toBeGreaterThan(0);
    for (const r of linked) {
      for (const id of r.values['q-job'] as Id[]) expect(out.rowTitles[id]).toMatch(/#\d+$/);
    }
  });
});

describe('filter, search and sort', () => {
  it('filters on visible properties and skips conditions on deleted ones', () => {
    const view = makeView({
      filter: all(cond('q-status', 'is', ['s-done']), cond('q-gone', 'is_not_empty')),
    });
    const done = MINE.filter((r) => r.values['q-status'] === 's-done');
    expect(answer(runViewQuery(qaQuery('agent', view))).count).toBe(done.length);
    const high = makeView({ filter: all(cond('q-score', 'gte', '70')) });
    expect(answer(runViewQuery(qaQuery('agent', high))).count).toBe(
      MINE.filter((r) => score(r) >= 70).length,
    );
  });

  it('sorts, breaking ties by the order rows were made', () => {
    const view = makeView({
      sorts: [{ propertyId: 'q-score', direction: 'desc' }],
      loadLimit: 100,
    });
    const want = [...MINE].sort((a, b) => score(b) - score(a) || index(a) - index(b)).slice(0, 100);
    expect(ids(answer(runViewQuery(qaQuery('agent', view))).rows)).toEqual(ids(want));
  });

  it('keeps the manual order without sorts, and the override can sort instead', () => {
    const view = makeView({ manualOrder: ['qa-007', 'qa-003', 'qa-000'], loadLimit: 10 });
    expect(ids(answer(runViewQuery(qaQuery('agent', view))).rows).slice(0, 4)).toEqual([
      'qa-007',
      'qa-003',
      'qa-001',
      'qa-005',
    ]);
    const override: ViewOverride = { sorts: [{ propertyId: 'q-score', direction: 'asc' }] };
    const sorted = answer(runViewQuery(qaQuery('agent', view, { override }))).rows.map((r) =>
      Number(r.values['q-score']),
    );
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
  });

  it('shows feeds newest first unless they sort', () => {
    const feed = answer(
      runViewQuery(qaQuery('agent', makeView({ layout: 'feed', loadLimit: 10 }))),
    );
    expect(ids(feed.rows).slice(0, 3)).toEqual(['qa-239', 'qa-237', 'qa-235']);
  });

  it('search finds words in any visible property, all words needed', () => {
    expect(
      answer(runViewQuery(qaQuery('agent', makeView(), { search: 'Jordan routine' }))).count,
    ).toBe(MINE.length);
    expect(
      answer(runViewQuery(qaQuery('agent', makeView(), { search: 'Avery routine' }))).count,
    ).toBe(0);
    expect(
      answer(runViewQuery(qaQuery('manager', makeView(), { search: 'review 217' }))).count,
    ).toBe(1);
  });

  it('works out the person filter "me" for whoever is looking', () => {
    const view = makeView({ filter: all(cond('q-agent', 'contains_any', ['me'])) });
    expect(answer(runViewQuery(qaQuery('agent', view))).count).toBe(MINE.length);
    expect(answer(runViewQuery(qaQuery('manager', view))).count).toBe(QA_ROWS.length - MINE.length);
  });

  it('agrees with idsIn for every row it sends', () => {
    const out = answer(runViewQuery(qaQuery('agent', makeView({ loadLimit: 100 }))));
    for (const r of out.rows) {
      const source = QA_ROWS.find((s) => s.id === r.id);
      expect(source && idsIn(source, 'q-agent')).toEqual(['u-jordan']);
    }
  });
});
