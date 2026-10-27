import { describe, expect, it } from 'vitest';
import type { QueryRow, ViewData } from '../contract';
import {
  fixtureRow,
  groupedByStatus,
  jobsRows,
  PROPS,
  queryData,
  queryRow,
  STATUS,
  viewData,
} from '../fixtures';
import { buildSections, numberRows, type Created } from './lines';

const none = new Set<string>();
const ids = (data: ViewData, created: readonly Created[] = []) =>
  buildSections({ data, created, collapsed: none, open: null }).map((s) =>
    s.lines.map((l) => l.row.id),
  );

describe('buildSections', () => {
  it('makes one list of every row when there are no groups', () => {
    expect(ids(viewData(queryData()))).toEqual([jobsRows().map((r) => r.id)]);
  });

  it('makes a list per group, and marks the collapsed ones', () => {
    const data = viewData(groupedByStatus());
    const sections = buildSections({
      data,
      created: [],
      collapsed: new Set([STATUS.done]),
      open: null,
    });
    expect(sections.map((s) => s.key)).toEqual(data.groups?.map((g) => g.key));
    expect(sections.map((s) => s.collapsed)).toEqual(
      data.groups?.map((g) => g.key === STATUS.done),
    );
  });

  it('keeps a row made here at the end until the answer has it', () => {
    const data = viewData(queryData());
    const row = queryRow(fixtureRow('row-tap', 'Fit outdoor tap', 9));
    const created: Created[] = [{ row, sectionKey: '', data }];
    const [list] = buildSections({ data, created, collapsed: none, open: null });
    expect(list?.lines.at(-1)?.row.id).toBe('row-tap');
    expect(list?.lines.at(-1)?.hidden).toBe(false);
    // A newer answer without it: a filter hides it.
    const [later] = buildSections({
      data: viewData(queryData()),
      created,
      collapsed: none,
      open: null,
    });
    expect(later?.lines.at(-1)?.hidden).toBe(true);
    // Once the answer has it, it's there once.
    const withIt = viewData(
      queryData([...jobsRows(), fixtureRow('row-tap', 'Fit outdoor tap', 9)]),
    );
    expect(ids(withIt, created)[0]?.filter((id) => id === 'row-tap')).toHaveLength(1);
  });

  it('leaves out the sub-items of closed rows', () => {
    const [parent, child] = jobsRows().map(queryRow);
    if (!parent || !child) throw new Error('The fixture needs rows.');
    const rows: QueryRow[] = [
      { ...parent, childCount: 1 },
      { ...child, parentId: parent.id, depth: 1 },
    ];
    const data = viewData(queryData([], { rows }));
    const shown = (open: boolean) =>
      buildSections({ data, created: [], collapsed: none, open: () => open })[0]?.lines.length;
    expect(shown(false)).toBe(1);
    expect(shown(true)).toBe(2);
  });
});

describe('numberRows', () => {
  it('counts the header, group headings, lines, Load more, New and totals', () => {
    const answer = groupedByStatus();
    const groups = (answer.groups ?? []).map((g, index) =>
      index === 0
        ? {
            ...g,
            nextCursor: 'more',
            totals: {
              [PROPS.cost]: { value: { kind: 'number' as const, value: 1 }, text: 'Sum 1' },
            },
          }
        : g,
    );
    const data = viewData({ ...answer, groups });
    const sections = buildSections({
      data,
      created: [],
      collapsed: new Set([groups[1]?.collapsedKey ?? '']),
      open: null,
    });
    const [first, second, third] = sections;
    if (!first || !second || !third) throw new Error('The fixture needs three groups.');
    const { of, last } = numberRows(sections, true);
    // Header 1; the first group: heading 2, its lines, Load more, New and totals.
    const a = 2 + first.lines.length;
    expect(of.get(first.key)).toEqual({
      head: 2,
      first: 3,
      more: a + 1,
      add: a + 2,
      totals: a + 3,
    });
    // The collapsed group has a heading only.
    expect(of.get(second.key)).toEqual({ head: a + 4, first: 0, more: 0, add: 0, totals: 0 });
    const b = a + 5 + third.lines.length;
    expect(of.get(third.key)).toEqual({
      head: a + 5,
      first: a + 6,
      more: 0,
      add: b + 1,
      totals: 0,
    });
    expect(last).toBe(b + 1);
  });

  it('counts one list without New', () => {
    const sections = buildSections({
      data: viewData(queryData()),
      created: [],
      collapsed: none,
      open: null,
    });
    const { of, last } = numberRows(sections, false);
    expect(of.get('')).toEqual({ head: 0, first: 2, more: 0, add: 0, totals: 0 });
    expect(last).toBe(1 + jobsRows().length);
  });
});
