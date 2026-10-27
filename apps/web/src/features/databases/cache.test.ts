import { describe, expect, it } from 'vitest';
import type { Property, SelectOption } from '@carehub/databases';
import {
  findQueryRow,
  mapQueryRows,
  mergeMore,
  moreRequest,
  moveInCache,
  savedOptionIds,
  titlePropertyId,
  withOptionIds,
  withTypedOptions,
  withValues,
} from './cache';
import {
  groupedByStatus,
  jobsDatabase,
  jobsProperties,
  jobsRows,
  PRIORITY,
  PROPS,
  queryData,
  queryRow,
  STATUS,
  USERS,
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

describe('mergeMore and the names of people', () => {
  it('adds the names the next page gives to the ones shown, in the view and in groups', () => {
    const avery = { name: USERS.avery.name, avatarUrl: null };
    const jordan = { name: USERS.jordan.name, avatarUrl: '/api/files/photo-jordan' };
    const rows = jobsRows();
    const first = queryData([at(rows, 0)], {
      count: 2,
      nextCursor: 'c2',
      people: { [USERS.avery.id]: avery },
    });
    const page = queryData([at(rows, 1)], {
      continued: true,
      people: { [USERS.jordan.id]: jordan },
    });
    const both = { [USERS.avery.id]: avery, [USERS.jordan.id]: jordan };
    expect(mergeMore(first, page).people).toEqual(both);

    const grouped = { ...groupedByStatus(), people: { [USERS.avery.id]: avery } };
    const more = { ...grouped, continued: true, groups: [], people: { [USERS.jordan.id]: jordan } };
    expect(mergeMore(grouped, more, STATUS.done).people).toEqual(both);
    const nameless = queryData([], { people: undefined });
    expect(mergeMore(nameless, { ...nameless, continued: true }).people).toBeUndefined();
  });
});

describe('options typed into cells', () => {
  const urgent: SelectOption = { id: 'typed-urgent', name: 'Urgent', color: 'orange' };
  // Typed in lower case: the property's own "High" is used instead.
  const high: SelectOption = { id: 'typed-high', name: 'high', color: 'blue' };
  const priority = (meta: { properties: Property[] }) =>
    meta.properties.find((p) => p.id === PROPS.priority);
  const names = (property: Property | undefined) =>
    property?.config.type === 'select' ? property.config.options.map((o) => o.name) : [];

  it('adds new options once, in the order typed, leaving out names the property has', () => {
    const meta = jobsDatabase();
    const added = withTypedOptions(meta, PROPS.priority, [urgent, high, urgent]);
    expect(names(priority(added))).toEqual(['High', 'Medium', 'Low', 'Urgent']);
    expect(priority(meta)).toEqual(priority(jobsDatabase()));
    expect(withTypedOptions(added, PROPS.priority, [urgent, high])).toBe(added);
    // Status options aren't typed into cells.
    expect(withTypedOptions(meta, PROPS.status, [urgent])).toBe(meta);
  });

  it('saves the id of the option of the same name the property already had', () => {
    const property = priority(withTypedOptions(jobsDatabase(), PROPS.priority, [urgent, high]));
    expect(savedOptionIds(property, [urgent, high])).toEqual({
      'typed-urgent': 'typed-urgent',
      'typed-high': PRIORITY.high,
    });
    expect(savedOptionIds(undefined, [urgent])).toEqual({ 'typed-urgent': 'typed-urgent' });
  });

  it('swaps the ids in Select and Multi-select values, once each', () => {
    const ids = { 'typed-high': PRIORITY.high };
    expect(withOptionIds('typed-high', ids)).toBe(PRIORITY.high);
    expect(withOptionIds([PRIORITY.high, 'typed-high', 'typed-urgent'], ids)).toEqual([
      PRIORITY.high,
      'typed-urgent',
    ]);
    expect(withOptionIds(null, ids)).toBeNull();
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
