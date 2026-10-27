import { describe, expect, it } from 'vitest';
import type { View } from '@carehub/databases';
import { defaultView } from '@carehub/databases/schema';
import { jobsProperties, jobsViews } from '../fixtures';
import { fitTabs, newViewName, placeTab, tabAfterDelete, viewMenuLabel } from './tabs';

const properties = jobsProperties();

function view(id: string, name: string, dashboardId?: string): View {
  return { ...defaultView('table', properties, { name }), id, ...(dashboardId && { dashboardId }) };
}

// Three tabs, and a dashboard ("Overview") whose tile sits between them in the saved order.
const views = [
  view('v-all', 'All jobs'),
  view('v-dash', 'Overview'),
  view('v-tile', 'Open jobs tile', 'v-dash'),
  view('v-week', 'This week'),
];

describe('newViewName', () => {
  it('names a new view after its layout, numbered when the name is taken', () => {
    expect(newViewName('board', jobsViews())).toBe('Board');
    const withBoard = [...jobsViews(), view('v-board', 'board')];
    expect(newViewName('board', withBoard)).toBe('Board 2');
    expect(newViewName('table', withBoard)).toBe('Table');
  });
});

describe('viewMenuLabel', () => {
  it("names the view the menu is for, and 'Untitled' when it has no name", () => {
    expect(viewMenuLabel(view('v-1', 'All jobs'))).toBe('More actions for All jobs');
    expect(viewMenuLabel(view('v-2', ''))).toBe('More actions for Untitled');
  });
});

describe('fitTabs', () => {
  const widths = [60, 80, 70, 90];
  const sizes = { widths, gap: 10, more: 50, active: 0 };

  it('shows every tab when they all fit, without More', () => {
    // 60 + 80 + 70 + 90 and three gaps of 10.
    expect(fitTabs({ ...sizes, room: 330 })).toEqual([0, 1, 2, 3]);
  });

  it('shows the tabs that fit beside More', () => {
    // 60 + 10 + 80 + 50 (More with its gap) = 200; the third tab needs 80 more.
    expect(fitTabs({ ...sizes, room: 250 })).toEqual([0, 1]);
    expect(fitTabs({ ...sizes, room: 280 })).toEqual([0, 1, 2]);
  });

  it('keeps the tab showing in sight, in the last place that fits', () => {
    expect(fitTabs({ ...sizes, room: 250, active: 3 })).toEqual([0, 3]);
    expect(fitTabs({ ...sizes, room: 250, active: 1 })).toEqual([0, 1]);
  });

  it('shows at least the tab showing, however narrow the room', () => {
    expect(fitTabs({ ...sizes, room: 40, active: 2 })).toEqual([2]);
    expect(fitTabs({ ...sizes, room: 40, active: -1 })).toEqual([]);
  });
});

describe('placeTab', () => {
  it('moves a tab before or after another and keeps the tiles in their places', () => {
    const order = (viewId: string, targetId: string, after: boolean) =>
      placeTab(views, viewId, targetId, after);
    expect(order('v-week', 'v-all', false)).toEqual(['v-week', 'v-all', 'v-tile', 'v-dash']);
    expect(order('v-all', 'v-dash', true)).toEqual(['v-dash', 'v-all', 'v-tile', 'v-week']);
    expect(order('v-all', 'v-week', true)).toEqual(['v-dash', 'v-week', 'v-tile', 'v-all']);
  });

  it('is null when nothing would move', () => {
    expect(placeTab(views, 'v-all', 'v-dash', false)).toBeNull();
    expect(placeTab(views, 'v-dash', 'v-dash', true)).toBeNull();
    expect(placeTab(views, 'v-tile', 'v-all', false)).toBeNull();
    expect(placeTab(views, 'v-all', 'v-gone', false)).toBeNull();
  });
});

describe('tabAfterDelete', () => {
  const tabs = [views[0]!, views[1]!, views[3]!];

  it('shows the next tab, or the one before for the last tab', () => {
    expect(tabAfterDelete(tabs, 'v-all')).toBe('v-dash');
    expect(tabAfterDelete(tabs, 'v-week')).toBe('v-dash');
  });

  it('has none for the only tab or an unknown one', () => {
    expect(tabAfterDelete([views[0]!], 'v-all')).toBeNull();
    expect(tabAfterDelete(tabs, 'v-gone')).toBeNull();
  });
});
