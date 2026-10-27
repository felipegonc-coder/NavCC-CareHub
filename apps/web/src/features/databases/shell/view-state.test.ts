import { afterEach, describe, expect, it, vi } from 'vitest';
import type { View } from '@carehub/databases';
import { jobsDatabase, PROPS, VIEWS } from '../fixtures';
import {
  canEditViews,
  lastViewKey,
  mergeOverride,
  pickView,
  readLastView,
  rememberView,
  tabViews,
} from './view-state';

function views(): View[] {
  const [table, board] = jobsDatabase().views;
  if (!table || !board) throw new Error('The fixture has two views.');
  const tile: View = { ...table, id: 'view-tile', name: 'Open jobs', dashboardId: 'view-dash' };
  return [table, tile, board];
}

const bySort = [{ propertyId: PROPS.due, direction: 'asc' as const }];

describe('tabViews', () => {
  it("lists views in order, leaving out a dashboard's tiles", () => {
    expect(tabViews(views()).map((v) => v.id)).toEqual([VIEWS.table, VIEWS.board]);
  });
});

describe('pickView', () => {
  it('opens the view the link names', () => {
    expect(pickView(views(), VIEWS.board, VIEWS.table)?.id).toBe(VIEWS.board);
  });

  it('opens the view used last when the link names none', () => {
    expect(pickView(views(), undefined, VIEWS.board)?.id).toBe(VIEWS.board);
  });

  it('opens the first tab when neither view exists any more', () => {
    expect(pickView(views(), 'view-gone', 'view-gone-too')?.id).toBe(VIEWS.table);
  });

  it("doesn't open a dashboard's tile as a tab", () => {
    expect(pickView(views(), 'view-tile', null)?.id).toBe(VIEWS.table);
  });

  it('has nothing to open without views', () => {
    expect(pickView([], VIEWS.table, null)).toBeNull();
  });
});

describe('last view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is remembered per database on this device', () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
    });
    rememberView('db-jobs', VIEWS.board);
    expect(saved.get(lastViewKey('db-jobs'))).toBe(VIEWS.board);
    expect(readLastView('db-jobs')).toBe(VIEWS.board);
    expect(readLastView('db-other')).toBeNull();
  });

  it('is forgotten quietly when storage is off', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage is off.');
      },
      setItem: () => {
        throw new Error('Storage is off.');
      },
    });
    expect(() => rememberView('db-jobs', VIEWS.board)).not.toThrow();
    expect(readLastView('db-jobs')).toBeNull();
  });
});

describe('mergeOverride', () => {
  it('adds the filter, sorts and grouping in a change and leaves out the rest', () => {
    const first = mergeOverride(null, { sorts: bySort, name: 'Mine' });
    expect(first).toEqual({ sorts: bySort });
    expect(mergeOverride(first, { filter: null })).toEqual({ sorts: bySort, filter: null });
  });

  it('is null when the change has nothing a viewer may change for themselves', () => {
    expect(mergeOverride(null, { name: 'Mine', loadLimit: 25 })).toBeNull();
  });
});

describe('canEditViews', () => {
  it('needs Can edit, and no Lock structure', () => {
    expect(canEditViews({ viewerAccess: 'edit', locked: false })).toBe(true);
    expect(canEditViews({ viewerAccess: 'full', locked: true })).toBe(false);
    expect(canEditViews({ viewerAccess: 'edit_content', locked: false })).toBe(false);
    expect(canEditViews({ viewerAccess: 'view', locked: false })).toBe(false);
  });
});
