import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderTargetContext } from '../shell/header-context';
import { pagesKeys } from './api';
import { PageScreen } from './PageScreen';

const { api, toast, Refused, editor, slots, remind } = vi.hoisted(() => {
  /** Stands in for ApiError. */
  class Refused extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  const run = vi.fn();
  /** Another feature's page menu item. */
  const remind = {
    id: 'remind',
    label: 'Remind me',
    order: 10,
    isVisible: vi.fn((_page: unknown) => true),
    onSelect: vi.fn(),
  };
  return {
    remind,
    api: {
      get: vi.fn<(path: string) => Promise<unknown>>(),
      post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      put: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      patch: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      delete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
    },
    toast: vi.fn(),
    Refused,
    editor: {
      isEmpty: true,
      commands: { focus: vi.fn() },
      on: vi.fn(),
      off: vi.fn(),
      getText: () => 'Refunds take five days.',
    },
    slots: {
      pageKindViews: {},
      pageHeaderExtras: {},
      pageBanners: [] as { id: string; order: number; Component: unknown }[],
      pageMenuItems: [remind],
      editor: {
        nodeViews: {},
        slashItems: [
          { id: 'heading1', title: 'Heading 1', run: vi.fn() },
          { id: 'table', title: 'Table view', run },
        ],
        linkPickers: [],
        bubbleItems: [],
        extensions: [],
      },
    },
  };
});
vi.mock('../../lib/api', () => ({ api, ApiError: Refused }));
vi.mock('../../slots', () => ({ slots }));
vi.mock('@carehub/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@carehub/ui')>()),
  useToast: () => ({ toast }),
}));
// The real editor needs a browser; this one hands its editor over like BlockEditor does.
vi.mock('@carehub/editor', async () => {
  const { createElement, useEffect } = await import('react');
  function BlockEditor({
    editable,
    onReady,
  }: {
    editable?: boolean;
    onReady?(editor: unknown): void;
  }) {
    useEffect(() => onReady?.(editor), [onReady]);
    return createElement('div', {
      role: 'textbox',
      'aria-label': 'Page content',
      'aria-readonly': !editable,
    });
  }
  return { BlockEditor };
});

// Radix menus measure themselves; jsdom can't.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const HINT = 'Press Enter to start writing, or start with:';
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const sam = { id: 'sam', name: 'Sam Ortiz' };
const support = { id: 'support', kind: 'space', title: 'Support', icon: null };
const space = { id: 'support', kind: 'open', name: 'Support', icon: null };
const policies = { id: 'policies', kind: 'page', title: 'Policies', icon: null };
const mine = { id: 'me', kind: 'space', title: 'Private', icon: null };

// Fictional pages, as the server sends them.
const refunds = (more: Record<string, unknown> = {}) => ({
  id: 'refunds',
  kind: 'page',
  spaceId: 'support',
  parentId: 'policies',
  title: 'Refund steps',
  icon: { type: 'emoji', emoji: '🚀' },
  cover: null,
  fullWidth: false,
  access: 'full',
  path: [support, policies],
  updatedAt: at(-5 * 60_000),
  updatedBy: sam,
  ...more,
});

let pages = new Map<string, Record<string, unknown>>();
let refused = new Map<string, number>();

/** The shell's top bar, which the page fills. */
function Shell({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return (
    <>
      <header ref={setTarget} />
      <HeaderTargetContext.Provider value={target}>{children}</HeaderTargetContext.Provider>
    </>
  );
}

function open(id: string, state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: `/p/${id}`, state }]}>
        <Shell>
          <Routes>
            <Route path="/p/:pageId" element={<PageScreen />} />
            <Route path="/" element={<p>Home</p>} />
          </Routes>
        </Shell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

const titleField = () => screen.findByRole('textbox', { name: 'Page title' });
const topBar = () => screen.getByRole('banner');

/** Opens "…" in the top bar, as the keyboard does. */
async function openMenu() {
  await titleField();
  fireEvent.keyDown(within(topBar()).getByRole('button', { name: 'Page menu' }), { key: 'Enter' });
  return screen.findByRole('menu');
}

/** The menu's items, in order. */
const itemsOf = (menu: HTMLElement) =>
  Array.from(menu.querySelectorAll('[role^="menuitem"]'), (item) => item.textContent);

/** Stands in for another feature's banner, such as an archive banner. */
function ArchivedBanner({ page }: { page: { title: string } }) {
  return <p>{`${page.title} is archived.`}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  editor.isEmpty = true;
  slots.pageBanners.length = 0;
  remind.isVisible.mockReturnValue(true);
  pages = new Map<string, Record<string, unknown>>([
    ['refunds', refunds()],
    ['policies', { ...refunds(), id: 'policies', title: 'Policies', icon: null, path: [support] }],
  ]);
  refused = new Map([['secret', 403]]);
  api.get.mockImplementation(async (path) => {
    const id = path.startsWith('/api/pages/') ? path.slice('/api/pages/'.length) : null;
    if (id !== null) {
      const page = pages.get(id);
      if (page) return { page };
      throw new Refused(refused.get(id) ?? 404, 'Refused');
    }
    if (path === '/api/favorites') return { favorites: [] };
    if (path === '/api/spaces')
      return { spaces: [space, { id: 'me', kind: 'personal', name: 'Private' }] };
    if (path.endsWith('/tree')) return { nodes: [] };
    if (path === '/api/auth/me') return { member: { permissions: ['pages.create'] } };
    return {};
  });
  api.patch.mockImplementation(async (path, body) => {
    const id = path.slice('/api/pages/'.length);
    const { locked, archived, ...rest } = body as Record<string, unknown>;
    const page = { ...pages.get(id), ...rest };
    if (locked !== undefined) page.lockedAt = locked ? at(0) : undefined;
    if (archived !== undefined) page.archivedAt = archived ? at(0) : undefined;
    pages.set(id, page);
    return null;
  });
  api.post.mockImplementation(async (path) => {
    const id = /^\/api\/trash\/([^/]+)\/restore$/.exec(path)?.[1];
    if (id) pages.set(id, { ...pages.get(id), deletedAt: undefined });
    return null;
  });
  api.put.mockResolvedValue(null);
  api.delete.mockImplementation(async (path) => {
    const id = /^\/api\/pages\/([^/]+)$/.exec(path)?.[1];
    if (id) pages.set(id, { ...pages.get(id), deletedAt: at(0) });
    return null;
  });
});

describe('PageScreen', () => {
  it('shows the breadcrumbs, title, icon, tab title and when the page was edited', async () => {
    open('refunds');
    expect(await titleField()).toHaveValue('Refund steps');
    expect(document.title).toBe('Care Hub · 🚀 Refund steps');
    expect(screen.getByRole('button', { name: 'Page icon' })).toHaveTextContent('🚀');
    const crumbs = within(topBar()).getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(crumbs).getByRole('link', { name: 'Policies' })).toHaveAttribute(
      'href',
      '/p/policies',
    );
    expect(within(crumbs).getByText('Support')).toBeInTheDocument();
    expect(within(crumbs).getByText('Refund steps').parentElement).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(topBar()).getByText('Edited 5m ago')).toHaveAttribute(
      'title',
      expect.stringMatching(/^Edited by Sam Ortiz, /),
    );
    expect(within(topBar()).queryByText('View only')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Page content' })).toHaveAttribute(
      'aria-readonly',
      'false',
    );
  });

  it('folds the middle of a long path into "…"', async () => {
    const deep = [support, policies, { ...policies, id: 'eu', title: 'Europe' }];
    pages.set('refunds', refunds({ path: [...deep, { ...policies, id: 'fr', title: 'France' }] }));
    open('refunds');
    await titleField();
    const crumbs = within(topBar()).getByRole('navigation', { name: 'Breadcrumbs' });
    expect(within(crumbs).getByRole('button', { name: 'Pages in between' })).toBeInTheDocument();
    expect(within(crumbs).queryByRole('link', { name: 'Policies' })).not.toBeInTheDocument();
    expect(within(crumbs).getByRole('link', { name: 'France' })).toBeInTheDocument();
  });

  it('shows View only and a read-only page to someone who can only view', async () => {
    pages.set('refunds', refunds({ access: 'view' }));
    open('refunds');
    expect(await titleField()).toHaveAttribute('readonly');
    expect(within(topBar()).getByText('View only')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Page content' })).toHaveAttribute(
      'aria-readonly',
      'true',
    );
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Page icon' })).toHaveTextContent('🚀');
    expect(screen.queryByRole('button', { name: 'Page icon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add cover' })).not.toBeInTheDocument();
  });

  it('renames as it is typed: the tab title at once, the server after a pause', async () => {
    open('refunds');
    fireEvent.change(await titleField(), { target: { value: 'Refund steps 2026' } });
    await waitFor(() => expect(document.title).toBe('Care Hub · 🚀 Refund steps 2026'));
    expect(api.patch).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/pages/refunds', { title: 'Refund steps 2026' }),
    );
  });

  it('puts the title back and says why when the server refuses the rename', async () => {
    api.patch.mockRejectedValueOnce(new Refused(403, 'Only people who can edit can rename it.'));
    open('refunds');
    const title = await titleField();
    fireEvent.change(title, { target: { value: 'Refunds' } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Couldn't rename the page.",
        description: 'Only people who can edit can rename it.',
        variant: 'danger',
      }),
    );
    expect(title).toHaveValue('Refund steps');
  });

  it('opens a new page with the cursor in the title; Enter goes to the first block', async () => {
    pages.set('fresh', refunds({ id: 'fresh', title: '', icon: null }));
    open('fresh', { focusTitle: true });
    const title = await titleField();
    expect(title).toHaveFocus();
    expect(document.title).toBe('Care Hub · Untitled');
    expect(screen.getByText(HINT)).toBeInTheDocument();
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(editor.commands.focus).toHaveBeenCalledWith('start');
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('offers "Add to:" on a page made with New page, and moves it where the person picks', async () => {
    pages.set(
      'draft',
      refunds({ id: 'draft', title: '', spaceId: 'me', parentId: null, path: [mine] }),
    );
    api.post.mockImplementation(async (path, body) => {
      if (path === '/api/pages/draft/move') {
        pages.set('draft', { ...pages.get('draft'), ...(body as object), path: [support] });
      }
      return null;
    });
    open('draft', { focusTitle: true, addTo: true });
    expect(await titleField()).toHaveFocus();
    fireEvent.click(await screen.findByRole('button', { name: 'Add to: Private' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add “Untitled” to' });
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Support/ }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/pages/draft/move', {
        spaceId: 'support',
        parentId: null,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add to: Private' })).not.toBeInTheDocument(),
    );
  });

  it('leaves "Add to:" out of pages elsewhere, and for someone who may not move the page', async () => {
    pages.set('notes', refunds({ id: 'notes', spaceId: 'me', parentId: null, path: [mine] }));
    pages.set('shared', { ...pages.get('notes'), id: 'shared', access: 'edit' });
    for (const id of ['refunds', 'shared']) {
      const queryClient = open(id, { addTo: true });
      await titleField();
      await waitFor(() =>
        expect(queryClient.getQueryState(pagesKeys.spaces)?.status).toBe('success'),
      );
      expect(screen.queryByRole('button', { name: /^Add to/ })).not.toBeInTheDocument();
      cleanup();
    }
    open('notes', { addTo: true });
    expect(await screen.findByRole('button', { name: 'Add to: Private' })).toBeInTheDocument();
  });

  it('starts a new page with a database view from the hint', async () => {
    open('refunds');
    await titleField();
    expect(screen.queryByRole('button', { name: 'Heading 1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(slots.editor.slashItems[1]?.run).toHaveBeenCalledWith(editor);
  });

  it('stars the page with Favorite', async () => {
    open('refunds');
    await titleField();
    const star = within(topBar()).getByRole('button', { name: 'Favorite' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/favorites', { pageId: 'refunds' }),
    );
  });

  it('goes to the parent page with Ctrl+Shift+U', async () => {
    open('refunds');
    await titleField();
    fireEvent.keyDown(window, { key: 'U', ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveValue('Policies'),
    );
  });

  it('says when a page is not there', async () => {
    open('gone');
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.getByText('This was deleted, or the link is wrong.')).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Not found');
  });

  it('says so when the person has no access', async () => {
    open('secret');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.getByText("You don't have access to this.")).toBeInTheDocument();
  });

  it('shows grey lines while a slow page loads', async () => {
    api.get.mockImplementation(() => new Promise(() => undefined));
    open('refunds');
    expect(await screen.findByRole('status')).toHaveTextContent('Loading the page');
  });

  it('shows an archived page read-only, under the banners other features add', async () => {
    slots.pageBanners.push({ id: 'archived', order: 10, Component: ArchivedBanner });
    pages.set('refunds', refunds({ archivedAt: '2026-10-20T15:00:00Z', archivedBy: sam }));
    open('refunds');
    const banner = await screen.findByText('Refund steps is archived.');
    const title = await titleField();
    expect(title).toHaveAttribute('readonly');
    expect(banner.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Unarchive' }));
    expect(api.patch).toHaveBeenCalledWith('/api/pages/refunds', { archived: false });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Page title' })).not.toHaveAttribute('readonly'),
    );
  });

  it('shows a locked page read-only, and Unlock needs Can edit', async () => {
    const avery = { id: 'avery', name: 'Avery Lin' };
    pages.set('refunds', refunds({ access: 'edit', lockedAt: at(-60_000), lockedBy: avery }));
    open('refunds');
    expect(await screen.findByText('Locked by Avery Lin')).toBeInTheDocument();
    expect(await titleField()).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.queryByText('Locked by Avery Lin')).not.toBeInTheDocument());
    expect(api.patch).toHaveBeenCalledWith('/api/pages/refunds', { locked: false });
  });

  it('offers Restore and Delete forever on a page in Trash', async () => {
    pages.set('refunds', refunds({ deletedAt: at(-60_000), deletedBy: sam }));
    open('refunds');
    expect(await screen.findByText('This page is in Trash.')).toBeInTheDocument();
    expect(await titleField()).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(screen.queryByText('This page is in Trash.')).not.toBeInTheDocument(),
    );
    expect(api.post).toHaveBeenCalledWith('/api/trash/refunds/restore', {});
  });

  it('deletes a page in Trash forever after asking, then goes Home', async () => {
    pages.set('refunds', refunds({ deletedAt: at(-60_000), deletedBy: sam }));
    open('refunds');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete forever' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Refund steps forever?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(api.delete).toHaveBeenCalledWith('/api/trash/refunds');
  });
});

describe('PageScreen page menu', () => {
  it('offers everything to someone with full access, then the other features, then Page info', async () => {
    const avery = { id: 'avery', name: 'Avery Lin' };
    pages.set('refunds', refunds({ createdAt: '2026-10-01T16:00:00Z', createdBy: avery }));
    open('refunds');
    const menu = await openMenu();
    expect(itemsOf(menu)).toEqual([
      'Full width',
      'Lock page',
      'Copy link',
      'Move to',
      'Move to Trash',
      'Archive',
      'Remind me',
    ]);
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Full width' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    const info = within(menu).getByRole('group', { name: 'Page info' });
    expect(within(info).getByText('4 words · 23 characters')).toBeInTheDocument();
    expect(within(info).getByText(/^Created by Avery Lin, Oct 1, 2026/)).toBeInTheDocument();
    expect(within(info).getByText(/^Edited by Sam Ortiz, /)).toBeInTheDocument();
  });

  it('shows only Copy link and visible items to someone who can only view', async () => {
    pages.set('refunds', refunds({ access: 'view' }));
    open('refunds');
    expect(itemsOf(await openMenu())).toEqual(['Copy link', 'Remind me']);
    expect(remind.isVisible).toHaveBeenCalledWith({
      id: 'refunds',
      kind: 'page',
      title: 'Refund steps',
    });
  });

  it("leaves out another feature's item when it says so, and runs it on the page", async () => {
    open('refunds');
    fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Remind me' }));
    expect(remind.onSelect).toHaveBeenCalledWith({
      id: 'refunds',
      kind: 'page',
      title: 'Refund steps',
    });
    remind.isVisible.mockReturnValue(false);
    expect(itemsOf(await openMenu())).not.toContain('Remind me');
  });

  it('switches Full width on', async () => {
    open('refunds');
    fireEvent.click(within(await openMenu()).getByRole('menuitemcheckbox', { name: 'Full width' }));
    expect(api.patch).toHaveBeenCalledWith('/api/pages/refunds', { fullWidth: true });
  });

  it('locks the page, which turns it read-only, and offers Unlock page', async () => {
    open('refunds');
    fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Lock page' }));
    expect(api.patch).toHaveBeenCalledWith('/api/pages/refunds', { locked: true });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveAttribute('readonly'),
    );
    expect(itemsOf(await openMenu())).toContain('Unlock page');
  });

  it('copies the link to the page', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open('refunds');
    fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/p\/refunds$/)),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Link copied' })),
    );
  });

  it('moves the page with Move to', async () => {
    open('refunds');
    fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Move to' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move “Refund steps” to' });
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Private/ }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/pages/refunds/move', {
        spaceId: 'me',
        parentId: null,
      }),
    );
  });

  it('moves the page to Trash, and the page says so', async () => {
    open('refunds');
    fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Move to Trash' }));
    expect(await screen.findByText('This page is in Trash.')).toBeInTheDocument();
    expect(api.delete).toHaveBeenCalledWith('/api/pages/refunds');
  });
});

describe('PageScreen icon and cover', () => {
  const rocket = { type: 'emoji', emoji: '🚀' };
  const ocean = { type: 'preset', name: 'ocean' };
  const picker = () => screen.findByRole('dialog', { name: 'Choose an icon' });

  it('adds an icon from the picker and shows it everywhere at once', async () => {
    pages.set('refunds', refunds({ icon: null }));
    const queryClient = open('refunds');
    const tree = ['pages', 'tree', 'support'];
    queryClient.setQueryData(tree, [{ id: 'refunds', title: 'Refund steps', icon: null }]);
    await titleField();
    expect(document.title).toBe('Care Hub · Refund steps');
    fireEvent.click(screen.getByRole('button', { name: 'Add icon' }));
    const search = within(await picker()).getByRole('searchbox', { name: 'Search emoji' });
    fireEvent.change(search, { target: { value: 'rocket' } });
    fireEvent.click(within(await picker()).getByRole('button', { name: 'rocket' }));
    expect(await screen.findByRole('button', { name: 'Page icon' })).toHaveTextContent('🚀');
    expect(document.title).toBe('Care Hub · 🚀 Refund steps');
    expect(queryClient.getQueryData(tree)).toEqual([
      { id: 'refunds', title: 'Refund steps', icon: rocket },
    ]);
    expect(api.patch).toHaveBeenCalledWith('/api/pages/refunds', { icon: rocket });
  });

  it('picks the first match with Enter, or one at random', async () => {
    pages.set('refunds', refunds({ icon: null }));
    open('refunds');
    await titleField();
    fireEvent.click(screen.getByRole('button', { name: 'Add icon' }));
    const search = within(await picker()).getByRole('searchbox', { name: 'Search emoji' });
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(within(await picker()).getByText('No emoji match.')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'sunfl' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'Page icon' })).toHaveTextContent('🌻');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    fireEvent.click(screen.getByRole('button', { name: 'Page icon' }));
    fireEvent.click(within(await picker()).getByRole('button', { name: 'Random' }));
    random.mockRestore();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Page icon' })).toHaveTextContent('😀'),
    );
  });

  it('removes the icon, and puts it back if the server refuses', async () => {
    api.patch.mockRejectedValueOnce(new Refused(403, 'Only people who can edit can change it.'));
    open('refunds');
    await titleField();
    fireEvent.click(screen.getByRole('button', { name: 'Page icon' }));
    fireEvent.click(within(await picker()).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Couldn't remove the icon.",
        description: 'Only people who can edit can change it.',
        variant: 'danger',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Page icon' })).toHaveTextContent('🚀');
    fireEvent.click(screen.getByRole('button', { name: 'Page icon' }));
    fireEvent.click(within(await picker()).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('button', { name: 'Add icon' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page icon' })).not.toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Refund steps');
    expect(api.patch).toHaveBeenLastCalledWith('/api/pages/refunds', { icon: null });
  });

  it('adds a cover from the gallery, changes it and removes it', async () => {
    open('refunds');
    await titleField();
    fireEvent.click(screen.getByRole('button', { name: 'Add cover' }));
    expect(await screen.findByRole('img', { name: 'Page cover' })).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/api/pages/refunds', {
      cover: { type: 'preset', name: expect.any(String) },
      coverPosition: 50,
    });
    expect(screen.queryByRole('button', { name: 'Add cover' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change cover' }));
    const gallery = await screen.findByRole('dialog', { name: 'Covers' });
    fireEvent.click(within(gallery).getByRole('button', { name: 'Ocean' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenLastCalledWith('/api/pages/refunds', { cover: ocean }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Page cover' })).not.toBeInTheDocument(),
    );
    expect(api.patch).toHaveBeenLastCalledWith('/api/pages/refunds', { cover: null });
  });

  it('moves the cover with Reposition and the arrow keys', async () => {
    pages.set('refunds', refunds({ cover: ocean, coverPosition: 50 }));
    open('refunds');
    await titleField();
    fireEvent.click(screen.getByRole('button', { name: 'Reposition' }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Cover position' }), { key: 'Escape' });
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reposition' }));
    const slider = screen.getByRole('slider', { name: 'Cover position' });
    expect(slider).toHaveFocus();
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(slider).toHaveAttribute('aria-valuenow', '54');
    expect(screen.queryByRole('button', { name: 'Change cover' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save position' }));
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/pages/refunds', { coverPosition: 54 }),
    );
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('shows the icon and cover, but no way to change them, to someone who can only view', async () => {
    pages.set('refunds', refunds({ access: 'view', cover: ocean }));
    open('refunds');
    await titleField();
    expect(screen.getByRole('img', { name: 'Page cover' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change cover' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reposition' })).not.toBeInTheDocument();
  });
});
