import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FeatureSlots, loadSlots, mergeSlots, slots } from './slots';

const Icon = () => null;
const View = () => null;
const OtherView = () => null;

function sidebarItem(id: string, order: number) {
  return { id, label: id, icon: Icon, to: `/${id}`, order };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mergeSlots', () => {
  it('gives empty slots without features', () => {
    expect(mergeSlots([])).toEqual({
      sidebarItems: [],
      sidebarSections: [],
      settingsSections: [],
      commands: [],
      pageMenuItems: [],
      pageKindViews: {},
      pageHeaderExtras: {},
      overlays: [],
      pageBanners: [],
      editor: { nodeViews: {}, slashItems: [], linkPickers: [], bubbleItems: [], extensions: [] },
    });
  });

  it('joins overlays in line order and sorts page banners by order', () => {
    const merged = mergeSlots([
      {
        overlays: [{ id: 'search', Component: View }],
        pageBanners: [{ id: 'verified', order: 20, Component: View }],
      },
      {
        overlays: [{ id: 'assistant', Component: OtherView }],
        pageBanners: [{ id: 'archived', order: 10, Component: OtherView }],
      },
    ]);
    expect(merged.overlays.map((overlay) => overlay.id)).toEqual(['search', 'assistant']);
    expect(merged.pageBanners.map((banner) => banner.id)).toEqual(['archived', 'verified']);
  });

  it('joins lists and sorts them by order, keeping line order for ties', () => {
    const merged = mergeSlots([
      { sidebarItems: [sidebarItem('messages', 20), sidebarItem('home', 0)] },
      {},
      { sidebarItems: [sidebarItem('calendar', 20), sidebarItem('learning', 10)] },
    ]);
    expect(merged.sidebarItems.map((item) => item.id)).toEqual([
      'home',
      'learning',
      'messages',
      'calendar',
    ]);
  });

  it('sorts sections and page menu items, and keeps commands in line order', () => {
    const run = () => undefined;
    const onSelect = () => undefined;
    const merged = mergeSlots([
      {
        sidebarSections: [{ id: 'later', order: 2, Component: View }],
        settingsSections: [{ id: 'roles', label: 'Roles', path: 'roles', order: 2, element: null }],
        commands: [{ id: 'new-page', title: 'New page', run }],
        pageMenuItems: [{ id: 'remind', label: 'Remind me', order: 5, onSelect }],
      },
      {
        sidebarSections: [{ id: 'upcoming', order: 1, Component: View }],
        settingsSections: [
          { id: 'members', label: 'Members', path: 'members', order: 1, element: null },
        ],
        commands: [{ id: 'new-chat', title: 'New chat', run }],
        pageMenuItems: [{ id: 'copy', label: 'Copy link', order: 1, onSelect }],
      },
    ]);
    expect(merged.sidebarSections.map((section) => section.id)).toEqual(['upcoming', 'later']);
    expect(merged.settingsSections.map((section) => section.id)).toEqual(['members', 'roles']);
    expect(merged.commands.map((command) => command.id)).toEqual(['new-page', 'new-chat']);
    expect(merged.pageMenuItems.map((item) => item.id)).toEqual(['copy', 'remind']);
  });

  it('merges objects, with later lines winning', () => {
    const merged = mergeSlots([
      { pageKindViews: { database: View }, pageHeaderExtras: { row: View } },
      { pageHeaderExtras: { row: OtherView } },
    ]);
    expect(merged.pageKindViews).toEqual({ database: View });
    expect(merged.pageHeaderExtras).toEqual({ row: OtherView });
  });

  it('joins the editor lists and merges the node views', () => {
    // Stand-ins for real editor items, whose types this test doesn't need.
    const item = (name: string) => ({ name }) as never;
    const picker = { label: 'Page', pick: async () => '/p/page-1' };
    const merged = mergeSlots([
      {
        editor: {
          nodeViews: { database: View },
          slashItems: [item('/database')],
          extensions: [item('database')],
        },
      },
      {
        editor: {
          nodeViews: { meetingNotes: OtherView },
          linkPickers: [picker],
          extensions: [item('meetingNotes')],
        },
      },
    ]);
    expect(merged.editor).toEqual({
      nodeViews: { database: View, meetingNotes: OtherView },
      slashItems: [{ name: '/database' }],
      linkPickers: [picker],
      bubbleItems: [],
      extensions: [{ name: 'database' }, { name: 'meetingNotes' }],
    });
  });
});

describe('loadSlots', () => {
  it('fills the shared slots and leaves out a feature that fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const learning: FeatureSlots = { sidebarItems: [sidebarItem('learning', 30)] };
    const home: FeatureSlots = { sidebarItems: [sidebarItem('home', 0)] };
    await loadSlots([
      async () => ({ slots: learning }),
      () => Promise.reject(new Error('chunk failed')),
      async () => ({}),
      async () => ({ slots: home }),
    ]);
    expect(slots.sidebarItems.map((item) => item.id)).toEqual(['home', 'learning']);
    expect(slots.editor.nodeViews).toEqual({});
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('loads without any feature lines', async () => {
    await loadSlots();
    expect(slots.sidebarItems).toEqual([]);
  });
});
