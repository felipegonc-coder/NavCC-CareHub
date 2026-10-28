import { describe, expect, it } from 'vitest';
import { mergeSlots, type SidebarItem } from '../../slots';
import { slots } from './slots';

const Icon = () => null;
const item = (id: string, order: number): SidebarItem => ({
  id,
  label: id,
  icon: Icon,
  to: `/${id}`,
  order,
});

describe("Home's slots", () => {
  it('puts Home first among the top items, linking to /', () => {
    const merged = mergeSlots([
      { sidebarItems: [item('calendar', 30), item('messages', 20)] },
      slots,
    ]);
    expect(merged.sidebarItems.map(({ id, label, to }) => ({ id, label, to }))).toEqual([
      { id: 'home', label: 'Home', to: '/' },
      { id: 'messages', label: 'messages', to: '/messages' },
      { id: 'calendar', label: 'calendar', to: '/calendar' },
    ]);
  });

  it('puts Upcoming first under the top items', () => {
    const merged = mergeSlots([
      { sidebarSections: [{ id: 'other', order: 20, Component: Icon }] },
      slots,
    ]);
    expect(merged.sidebarSections.map(({ id }) => id)).toEqual(['home-upcoming', 'other']);
  });
});
