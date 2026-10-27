import { describe, expect, it } from 'vitest';
import type { Grouping, Id, Row, View } from '../types';
import { JOB_ROWS, agentOpens, answer, jobsQuery, makeView } from './fixtures';
import { countRows, runViewQuery } from './query';
import { VIEW_BLOCKED, type QueryGroup, type ViewQueryData, type ViewQueryInput } from './shapes';

const num = (r: Row, id: Id): number => Number(r.values[id]);
const total = (rows: readonly Row[], id: Id) =>
  rows.length
    ? { kind: 'number', value: rows.reduce((a, r) => a + num(r, id), 0) }
    : { kind: 'empty' };
const status = (r: Row): string => String(r.values['j-status']);
const priority = (r: Row): string => String(r.values['j-priority'] ?? '__empty__');
const ids = (rows: readonly { id: Id }[]): Id[] => rows.map((r) => r.id);
const BOARD: NonNullable<View['board']> = {
  cardPreview: { kind: 'none' },
  cardSize: 'm',
  fitImage: false,
  colorColumns: false,
  headerCalculation: { propertyId: 'j-hours', aggregate: 'sum' },
};
const board = (patch: Partial<View> = {}): View =>
  makeView({
    layout: 'board',
    grouping: { propertyId: 'j-status' },
    subGrouping: { propertyId: 'j-priority' },
    calculations: { 'j-hours': 'sum', 'j-cost': 'sum' },
    board: BOARD,
    ...patch,
  });
const rowsIn = (groups: readonly QueryGroup[]): number =>
  groups.reduce((a, g) => a + g.rows.length + rowsIn(g.subGroups ?? []), 0);

/** Follows one group's (or the view's) cursors to the end; every row it was given, in order. */
function follow(input: ViewQueryInput, first: string | null, path: string[]): Id[] {
  const out: Id[] = [];
  for (let cursor = first; cursor;) {
    const page: ViewQueryData = answer(runViewQuery({ ...input, cursor }));
    expect(page.continued).toBe(true);
    let at: QueryGroup | undefined;
    for (const key of path)
      at = (at ? at.subGroups : (page.groups ?? []))?.find((g) => g.key === key);
    const part = at ?? { rows: page.rows, nextCursor: page.nextCursor };
    expect(part.rows.length).toBeGreaterThan(0);
    out.push(...ids(part.rows));
    cursor = part.nextCursor;
  }
  return out;
}

describe('groups, board sub-groups and totals', () => {
  const out = answer(runViewQuery(jobsQuery('manager', board())));

  it('totals every matching row, overall and per group and sub-group', () => {
    expect(out.count).toBe(JOB_ROWS.length);
    expect(out.totals['j-hours']?.value).toEqual(total(JOB_ROWS, 'j-hours'));
    expect(out.totals['j-cost']?.value).toEqual(total(JOB_ROWS, 'j-cost'));
    for (const g of out.groups ?? []) {
      const rows = JOB_ROWS.filter((r) => status(r) === g.key);
      expect(g.count).toBe(rows.length);
      expect(g.totals['j-hours']?.value).toEqual(total(rows, 'j-hours'));
      expect(g.totals['j-cost']?.value).toEqual(total(rows, 'j-cost'));
      expect(g.header?.value).toEqual(total(rows, 'j-hours'));
      for (const s of g.subGroups ?? []) {
        const here = rows.filter((r) => priority(r) === s.key);
        expect(s.count).toBe(here.length);
        expect(s.totals['j-cost']?.value).toEqual(total(here, 'j-cost'));
        for (const r of s.rows)
          expect([
            status(JOB_ROWS[Number(r.id.slice(4))] as Row),
            r.values['j-priority'] ?? '__empty__',
          ]).toEqual([g.key, s.key]);
      }
    }
  });

  it('lists every column and lane, lanes in the same order in each column', () => {
    expect(out.groups?.map((g) => g.key)).toEqual(['__empty__', 'js-new', 'js-sched', 'js-done']);
    const lanes = out.lanes?.map((l) => l.key);
    expect(lanes).toEqual(['__empty__', 'jp-high', 'jp-normal', 'jp-low']);
    for (const g of out.groups ?? []) expect(g.subGroups?.map((s) => s.key)).toEqual(lanes);
    for (const lane of out.lanes ?? []) {
      expect(lane.count).toBe(JOB_ROWS.filter((r) => priority(r) === lane.key).length);
    }
    expect(out.lanes?.[1]).toMatchObject({ label: 'High', color: 'red', hidden: false });
  });

  it('sends at most 100 rows in all and up to the load limit per sub-group', () => {
    expect(rowsIn(out.groups ?? [])).toBe(100);
    expect(out.rows).toEqual([]);
    for (const g of out.groups ?? []) {
      expect(g.rows).toEqual([]);
      for (const s of g.subGroups ?? []) {
        expect(s.rows.length).toBeLessThanOrEqual(50);
        expect(s.nextCursor === null).toBe(s.rows.length === s.count);
      }
    }
  });

  it('only counts and totals the rows the viewer can open', () => {
    const view = board({ calculations: { 'j-hours': 'sum' } });
    const mine = answer(runViewQuery(jobsQuery('agent', view)));
    const open = JOB_ROWS.filter(agentOpens);
    expect(mine.count).toBe(open.length);
    expect(mine.totals['j-hours']?.value).toEqual(total(open, 'j-hours'));
    for (const g of mine.groups ?? []) {
      expect(g.count).toBe(open.filter((r) => status(r) === g.key).length);
    }
    expect(mine.lanes?.reduce((a, l) => a + l.count, 0)).toBe(open.length);
    expect(runViewQuery(jobsQuery('agent', board()))).toEqual({ blocked: VIEW_BLOCKED });
  });

  it('keeps hidden groups counted but sends their rows only when asked', () => {
    const grouping: Grouping = { propertyId: 'j-status', hidden: ['js-done'] };
    const input = jobsQuery('manager', makeView({ grouping }));
    const first = answer(runViewQuery(input));
    const done = first.groups?.find((g) => g.key === 'js-done');
    expect(done).toMatchObject({ hidden: true, count: 72, rows: [] });
    expect(first.groups?.filter((g) => !g.hidden).map((g) => g.rows.length)).toEqual([50, 50]);
    const want = JOB_ROWS.filter((r) => status(r) === 'js-done').map((r) => r.id);
    expect(follow(input, done?.nextCursor ?? null, ['js-done'])).toEqual(want);
  });

  it('leaves out empty groups when asked, and groups only layouts that show groups', () => {
    const hide = answer(
      runViewQuery(
        jobsQuery('manager', board({ grouping: { propertyId: 'j-status', hideEmpty: true } })),
      ),
    );
    expect(hide.groups?.map((g) => g.key)).toEqual(['js-new', 'js-sched', 'js-done']);
    const table = answer(
      runViewQuery(
        jobsQuery(
          'manager',
          makeView({
            grouping: { propertyId: 'j-status' },
            subGrouping: { propertyId: 'j-priority' },
          }),
        ),
      ),
    );
    expect(table.groups?.map((g) => g.key)).toEqual(['js-new', 'js-sched', 'js-done']);
    expect(table.groups?.[0]?.subGroups).toBeUndefined();
    expect(table.lanes).toBeNull();
    const calendar = answer(
      runViewQuery(
        jobsQuery(
          'manager',
          makeView({ layout: 'calendar', grouping: { propertyId: 'j-status' } }),
        ),
      ),
    );
    expect(calendar.groups).toBeNull();
    expect(calendar.rows).toHaveLength(50);
  });

  it('countRows gives the same counts without rows', () => {
    const counts = countRows(jobsQuery('manager', board()));
    if ('blocked' in counts) throw new Error(counts.blocked);
    expect(counts.count).toBe(out.count);
    expect(counts.groups?.map((g) => [g.key, g.count, g.subGroups?.map((s) => s.count)])).toEqual(
      out.groups?.map((g) => [g.key, g.count, g.subGroups?.map((s) => s.count)]),
    );
    expect(counts.lanes?.map((l) => l.count)).toEqual(out.lanes?.map((l) => l.count));
    expect(countRows(jobsQuery('agent', board()))).toEqual({ blocked: VIEW_BLOCKED });
  });
});

describe('paging', () => {
  const byHours = makeView({
    sorts: [{ propertyId: 'j-hours', direction: 'desc' }],
    loadLimit: 25,
  });
  const hoursOrder = [...JOB_ROWS]
    .sort((a, b) => num(b, 'j-hours') - num(a, 'j-hours') || a.id.localeCompare(b.id))
    .map((r) => r.id);

  it('pages an ungrouped view by its load limit; following the cursors gives every row once', () => {
    const input = jobsQuery('manager', byHours);
    const first = answer(runViewQuery(input));
    expect(first.rows).toHaveLength(25);
    expect(first.continued).toBe(false);
    expect([...ids(first.rows), ...follow(input, first.nextCursor, [])]).toEqual(hoursOrder);
  });

  it('pages each group on its own, every row once', () => {
    const input = jobsQuery('manager', makeView({ grouping: { propertyId: 'j-status' } }));
    const first = answer(runViewQuery(input));
    expect(first.groups?.map((g) => g.rows.length)).toEqual([34, 33, 33]);
    for (const g of first.groups ?? []) {
      const want = JOB_ROWS.filter((r) => status(r) === g.key).map((r) => r.id);
      expect([...ids(g.rows), ...follow(input, g.nextCursor, [g.key])]).toEqual(want);
    }
  });

  it('pages a board sub-group on its own and answers only for it', () => {
    const input = jobsQuery('manager', board());
    const first = answer(runViewQuery(input));
    const sub = first.groups?.[1]?.subGroups?.[1];
    expect(sub?.key).toBe('jp-high');
    const next = answer(runViewQuery({ ...input, cursor: sub?.nextCursor ?? null }));
    expect(next.groups?.map((g) => [g.key, g.subGroups?.map((s) => s.key)])).toEqual([
      ['js-new', ['jp-high']],
    ]);
    expect(next.count).toBe(first.count);
    const want = JOB_ROWS.filter((r) => status(r) === 'js-new' && priority(r) === 'jp-high').map(
      (r) => r.id,
    );
    expect([
      ...ids(sub?.rows ?? []),
      ...follow(input, sub?.nextCursor ?? null, ['js-new', 'jp-high']),
    ]).toEqual(want);
  });

  it('carries on after the last row shown even when rows come and go', () => {
    const input = jobsQuery('manager', byHours);
    const first = answer(runViewQuery(input));
    const gone = new Set([first.rows[3]?.id]);
    const added: Row = { ...(JOB_ROWS[0] as Row), id: 'job-new', values: { 'j-hours': '9' } };
    const rows = [added, ...JOB_ROWS.filter((r) => !gone.has(r.id))];
    const next = answer(runViewQuery({ ...input, rows, cursor: first.nextCursor }));
    expect(ids(next.rows)).toEqual(hoursOrder.slice(25, 50));
    const moved = answer(
      runViewQuery({
        ...input,
        rows: JOB_ROWS.filter((r) => r.id !== first.rows[24]?.id),
        cursor: first.nextCursor,
      }),
    );
    expect(ids(moved.rows)).toEqual(hoursOrder.slice(25, 50));
  });

  it('caps a page at 100 rows whatever the load limit', () => {
    const out = answer(runViewQuery(jobsQuery('manager', makeView({ loadLimit: 200 }))));
    expect(out.rows).toHaveLength(100);
  });

  it('answers a cursor it does not know with nothing', () => {
    const grouped = jobsQuery('manager', makeView({ grouping: { propertyId: 'j-status' } }));
    for (const cursor of ['nonsense', 'c1:[["js-gone"],0,null]', 'c1:[[],0,null]']) {
      const out = answer(runViewQuery({ ...grouped, cursor }));
      expect(out).toMatchObject({
        continued: true,
        groups: [],
        rows: [],
        nextCursor: null,
        count: 220,
      });
    }
    const flat = answer(
      runViewQuery({ ...jobsQuery('manager', byHours), cursor: 'c1:[["js-new"],0,null]' }),
    );
    expect(flat).toMatchObject({ continued: true, rows: [], nextCursor: null });
  });
});
