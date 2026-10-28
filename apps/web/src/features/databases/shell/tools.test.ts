import { describe, expect, it } from 'vitest';
import type { DatabaseGrant, FilterGroup, View } from '@carehub/databases';
import { jobsViews, PROPS } from '../fixtures';
import {
  databaseLink,
  MORE_LABELS,
  moreItems,
  opensPanel,
  TOOL_LABELS,
  toolIsOn,
  toolsFor,
  type MoreInput,
} from './tools';

const [table, board] = jobsViews() as [View, View];

const paidOnly: FilterGroup = {
  kind: 'group',
  id: 'filter-root',
  combinator: 'and',
  children: [{ kind: 'condition', id: 'filter-paid', propertyId: PROPS.paid, op: 'is_checked' }],
};

describe('toolsFor', () => {
  it('gives table, board, list, gallery and timeline every button, in toolbar order', () => {
    for (const layout of ['table', 'board', 'list', 'gallery', 'timeline'] as const) {
      expect(toolsFor(layout, true).map((tool) => TOOL_LABELS[tool])).toEqual([
        'Filter',
        'Sort',
        'Group',
        'Search',
        'Properties',
      ]);
    }
  });

  it('has no Group for calendar and feed, only Filter for a chart, and none for forms', () => {
    expect(toolsFor('calendar', true)).toEqual(['filter', 'sort', 'search', 'properties']);
    expect(toolsFor('feed', true)).toEqual(['filter', 'sort', 'search', 'properties']);
    expect(toolsFor('chart', true)).toEqual(['filter']);
    expect(toolsFor('form', true)).toEqual([]);
    expect(toolsFor('dashboard', true)).toEqual([]);
  });

  it('leaves out Properties for people whose changes are only their own', () => {
    expect(toolsFor('table', false)).toEqual(['filter', 'sort', 'group', 'search']);
  });
});

describe('toolIsOn', () => {
  it('marks Filter, Sort and Group when the view has them, and Search while it searches', () => {
    const tools = ['filter', 'sort', 'group', 'search', 'properties'] as const;
    expect(tools.map((tool) => toolIsOn(tool, table, ''))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(toolIsOn('group', board, '')).toBe(true);
    expect(toolIsOn('filter', { ...table, filter: paidOnly }, '')).toBe(true);
    const byDue = [{ propertyId: PROPS.due, direction: 'asc' as const }];
    expect(toolIsOn('sort', { ...table, sorts: byDue }, '')).toBe(true);
    expect(toolIsOn('search', table, ' sink ')).toBe(true);
    expect(toolIsOn('search', table, '   ')).toBe(false);
  });
});

describe('moreItems', () => {
  const labels = (access: DatabaseGrant, change: Partial<MoreInput> = {}) =>
    moreItems({ access, locked: false, online: true, canDelete: true, ...change }).map(
      (item) => MORE_LABELS[item],
    );

  it('gives Full access every item, in menu order', () => {
    expect(labels('full')).toEqual([
      'Layout',
      'Import CSV',
      'Export CSV',
      'Lock structure',
      'Row access',
      'Property access',
      'Copy link',
      'Delete',
    ]);
  });

  it('gives Can edit Layout, Import CSV, Export CSV and Copy link', () => {
    expect(labels('edit')).toEqual(['Layout', 'Import CSV', 'Export CSV', 'Copy link']);
  });

  it('gives everyone else Export CSV and Copy link', () => {
    for (const access of ['edit_content', 'comment', 'view', 'rows_only'] as const) {
      expect(labels(access)).toEqual(['Export CSV', 'Copy link']);
    }
  });

  it('takes Layout away while Lock structure is on', () => {
    expect(labels('full', { locked: true })).toEqual([
      'Import CSV',
      'Export CSV',
      'Lock structure',
      'Row access',
      'Property access',
      'Copy link',
      'Delete',
    ]);
    expect(labels('edit', { locked: true })).toEqual(['Import CSV', 'Export CSV', 'Copy link']);
  });

  it('offers Delete only where the page can delete the database', () => {
    expect(labels('full', { canDelete: false })).not.toContain('Delete');
  });

  it('keeps only Copy link while offline', () => {
    expect(labels('full', { online: false })).toEqual(['Copy link']);
  });
});

describe('opensPanel', () => {
  it('is true for the items that open a panel or a dialog', () => {
    const panels = ['layout', 'importCsv', 'exportCsv', 'rowAccess', 'propertyAccess'] as const;
    expect(panels.every((item) => opensPanel(item))).toBe(true);
    const actions = ['lock', 'copyLink', 'delete'] as const;
    expect(actions.some((item) => opensPanel(item))).toBe(false);
  });
});

describe('databaseLink', () => {
  it("is the database page's address with the view", () => {
    expect(databaseLink('https://carehub.example', 'db-jobs', 'view-all-jobs')).toBe(
      'https://carehub.example/p/db-jobs?v=view-all-jobs',
    );
  });
});
