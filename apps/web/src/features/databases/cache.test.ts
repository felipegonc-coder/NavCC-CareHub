import { describe, expect, it } from 'vitest';
import {
  findQueryRow,
  mapQueryRows,
  mergeMore,
  moreRequest,
  moveInCache,
  titlePropertyId,
  withValues,
} from './cache';
import {
  groupedByStatus,
  jobsProperties,
  jobsRows,
  PROPS,
  queryData,
  queryRow,
  STATUS,
} from './fixtures';
import type { ViewQueryData } from './contract';

function at<T>(list: readonly T[] | null | undefined, index: number): T {
  const item = list?.[index];
  if (item === undefined) throw new Error('The fixture changed.');
  return item;
}

const ids = (data: ViewQueryData) => data.rows.map((r) => r.id);
const groupIds = (data: ViewQueryData, key: string) =>
  data.groups?.find((g) => g.key === key)?.rows.map((r) => r.id);

describe('moreRequest', () => {
  it('asks for the next page of the view or of a group', () => {
    expect(moreRequest(queryData(jobsRows(), { nextCursor: 'c2' }))).toEqual({ cursor: 'c2' });
    expect(moreRequest(queryData())).toBeNull();
    const grouped = groupedByStatus();
    const done = grouped.groups?.find((g) => g.key === STATUS.done);
    if (done) done.nextCursor = 'c-done';
    expect(moreRequest(grouped, STATUS.done)).toEqual({ cursor: 'c-done' });
    expect(moreRequest(grouped, STATUS.inProgress)).toBeNull();
    expect(moreRequest(grouped, 'missing')).toBeNull();
  });

  it("asks for a hidden group's rows by its key", () => {
    const grouped = groupedByStatus();
    const done = grouped.groups?.find((g) => g.key === STATUS.done);
    if (done) {
      done.hidden = true;
      done.rows = [];
    }
    expect(moreRequest(grouped, STATUS.done)).toEqual({ groupKey: STATUS.done });
  });
});

describe('mergeMore', () => {
  it('adds the next page of an ungrouped view once', () => {
    const rows = jobsRows();
    const [a, b, c, d] = [at(rows, 0), at(rows, 1), at(rows, 2), at(rows, 3)];
    const first = queryData([a, b], { count: 4, nextCursor: 'c2' });
    const page = queryData([b, c, d], { continued: true, nextCursor: null });
    const merged = mergeMore(first, page);
    expect(ids(merged)).toEqual(['row-sink', 'row-heater', 'row-boiler', 'row-drain']);
    expect(merged.nextCursor).toBeNull();
    expect(merged.count).toBe(4);
  });

  it("adds a group's next page and stops offering more when the group is gone", () => {
    const grouped = groupedByStatus();
    const extra = queryRow({ ...at(jobsRows(), 2), id: 'row-extra' });
    const page: ViewQueryData = {
      ...grouped,
      continued: true,
      groups: [{ ...at(grouped.groups, 2), rows: [extra], nextCursor: null }],
    };
    expect(groupIds(mergeMore(grouped, page, STATUS.done), STATUS.done)).toEqual([
      'row-boiler',
      'row-extra',
    ]);
    const withCursor: ViewQueryData = {
      ...grouped,
      groups: (grouped.groups ?? []).map((g) => ({ ...g, nextCursor: 'more' })),
    };
    const gone = mergeMore(withCursor, { ...page, groups: [] }, STATUS.done);
    expect(gone.groups?.find((g) => g.key === STATUS.done)?.nextCursor).toBeNull();
    expect(gone.groups?.find((g) => g.key === STATUS.notStarted)?.nextCursor).toBe('more');
  });
});

describe('mapQueryRows', () => {
  it('removes rows everywhere and keeps counts right', () => {
    const grouped = groupedByStatus();
    const next = mapQueryRows(grouped, (r) => (r.id === 'row-heater' ? null : r));
    expect(next.count).toBe(3);
    expect(next.groups?.find((g) => g.key === STATUS.notStarted)?.count).toBe(1);
    expect(groupIds(next, STATUS.notStarted)).toEqual(['row-drain']);
  });
});

describe('withValues', () => {
  it('puts the Name value in the title and clears with null', () => {
    const titleId = titlePropertyId(jobsProperties());
    expect(titleId).toBe(PROPS.name);
    const sink = queryRow(at(jobsRows(), 0));
    const next = withValues(
      sink,
      { [PROPS.name]: 'Fix sink', [PROPS.paid]: true, [PROPS.cost]: null },
      titleId,
    );
    expect(next.title).toBe('Fix sink');
    expect(next.values[PROPS.paid]).toBe(true);
    expect(next.values[PROPS.cost]).toBeNull();
    expect(next.values[PROPS.name]).toBeUndefined();
  });
});

describe('moveInCache', () => {
  it('reorders an ungrouped view', () => {
    const moved = moveInCache(queryData(), 'row-drain', { beforeRowId: 'row-sink' });
    expect(ids(moved)).toEqual(['row-drain', 'row-sink', 'row-heater', 'row-boiler']);
    expect(ids(moveInCache(queryData(), 'row-sink', {}))).toEqual([
      'row-heater',
      'row-boiler',
      'row-drain',
      'row-sink',
    ]);
  });

  it('moves a card to another column', () => {
    const moved = moveInCache(groupedByStatus(), 'row-heater', {
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.done,
      beforeRowId: 'row-boiler',
    });
    expect(groupIds(moved, STATUS.done)).toEqual(['row-heater', 'row-boiler']);
    expect(groupIds(moved, STATUS.notStarted)).toEqual(['row-drain']);
    expect(moved.groups?.find((g) => g.key === STATUS.done)?.count).toBe(2);
    expect(moved.count).toBe(4);
  });

  it('leaves the answer alone when the place is not loaded', () => {
    const grouped = groupedByStatus();
    expect(moveInCache(grouped, 'row-heater', { toGroupKey: 'missing' })).toBe(grouped);
    expect(moveInCache(grouped, 'missing', { toGroupKey: STATUS.done })).toBe(grouped);
  });
});

describe('findQueryRow', () => {
  it('finds a loaded row in the rows, a group or a sub-group', () => {
    expect(findQueryRow(queryData(), 'row-drain')?.title).toBe('Unclog bathroom drain');
    expect(findQueryRow(groupedByStatus(), 'row-boiler')?.title).toBe('Annual boiler service');
    const grouped = groupedByStatus();
    const lanes: ViewQueryData = {
      ...grouped,
      groups: (grouped.groups ?? []).map((g) => ({ ...g, rows: [], subGroups: [g] })),
    };
    expect(findQueryRow(lanes, 'row-sink')?.title).toBe('Fix kitchen sink leak');
  });

  it("is undefined for a row that isn't loaded", () => {
    expect(findQueryRow(queryData(), 'row-gone')).toBeUndefined();
  });
});
