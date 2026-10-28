import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PagesSidebar from './PagesSidebar';
import type { PageLink, Space, TreeNode } from './types';

const api = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  put: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  delete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
}));
vi.mock('../../lib/api', () => ({ api, ApiError: class extends Error {} }));
vi.mock('@carehub/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@carehub/ui')>()),
  useToast: () => ({ toast: () => undefined }),
}));
vi.mock('../../slots', async () => {
  const { createElement } = await import('react');
  const database = ({ page }: { page: TreeNode }) =>
    createElement('p', null, `Views of ${page.title}`);
  return { slots: { treeItemChildren: { database } } };
});

// Radix menus measure themselves; jsdom can't.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const node = (id: string, parentId: string | null, title: string, more: Partial<TreeNode> = {}) =>
  ({
    id,
    parentId,
    kind: 'page',
    title,
    icon: null,
    position: id,
    hasChildren: false,
    access: 'edit',
    ...more,
  }) satisfies TreeNode as TreeNode;

// A fictional workspace: a General space, the person's Private pages and nothing shared.
const spaces: Space[] = [
  { id: 'general', kind: 'open', name: 'General', icon: null },
  { id: 'mine', kind: 'personal', name: 'Private', icon: null },
];
const general = [
  node('a1', null, 'Onboarding'),
  node('a2', 'a1', 'Week one'),
  node('b1', null, 'Rota', { kind: 'database' }),
];
const onboarding: PageLink = {
  id: 'a1',
  kind: 'page',
  title: 'Onboarding',
  icon: null,
  access: 'edit',
  spaceId: 'general',
};

const defaults: Record<string, unknown> = {
  '/api/spaces': { spaces },
  '/api/spaces/general/tree': { nodes: general },
  '/api/spaces/mine/tree': { nodes: [node('m1', null, 'My notes')] },
  '/api/shared': { nodes: [] },
  '/api/favorites': { favorites: [] },
  '/api/recent': { pages: [{ ...onboarding, id: 'a2', title: 'Week one' }] },
  '/api/me/prefs': {},
  '/api/auth/me': { member: { permissions: ['pages.create'] } },
};

function Opened() {
  return <p>Opened {useParams().pageId}</p>;
}

function renderSidebar(responses: Record<string, unknown> = {}) {
  const data = { ...defaults, ...responses };
  api.get.mockImplementation(async (path) => {
    const value = data[path];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`Unexpected GET ${path}`);
    return value;
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PagesSidebar />
        <Routes>
          <Route path="/p/:pageId" element={<Opened />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const section = (name: string) => screen.getByRole('group', { name });

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset().mockResolvedValue({ id: 'new1' });
  api.put.mockReset().mockResolvedValue(null);
  api.delete.mockReset().mockResolvedValue(null);
});

describe('PagesSidebar', () => {
  it('shows each space, then Private; Shared stays hidden while empty', async () => {
    renderSidebar();
    const spacesSection = await screen.findByRole('group', { name: 'Spaces' });
    const general = within(spacesSection).getByRole('group', { name: 'General' });
    expect(within(general).getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(within(general).getByRole('button', { name: 'General' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const tree = await within(spacesSection).findByRole('tree', { name: 'General' });
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((item) => item.textContent),
    ).toEqual(['Onboarding', 'Rota']);
    expect(await within(section('Private')).findByText('My notes')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Shared' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Recent' })).not.toBeInTheDocument();
  });

  it('suggests starring pages until there are favorites', async () => {
    renderSidebar();
    expect(await screen.findByText('Star pages to keep them here.')).toBeInTheDocument();
  });

  it('lists favorites that open into their sub-pages', async () => {
    renderSidebar({ '/api/favorites': { favorites: [onboarding] } });
    const tree = await within(await screen.findByRole('group', { name: 'Favorites' })).findByRole(
      'tree',
      { name: 'Favorites' },
    );
    const item = await within(tree).findByRole('treeitem', { name: 'Onboarding' });
    await waitFor(() => expect(item).toHaveAttribute('aria-expanded', 'false'));
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    expect(await within(tree).findByRole('treeitem', { name: 'Week one' })).toBeInTheDocument();
  });

  it('collapses a section from its heading or its arrow, and saves that for the person', async () => {
    renderSidebar();
    const privateSection = await screen.findByRole('group', { name: 'Private' });
    const arrow = within(privateSection).getByRole('button', { name: 'Private' });
    expect(arrow).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(privateSection).getByRole('heading', { name: 'Private' }));
    expect(arrow).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('My notes')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/me/prefs/sidebar.collapsed', {
        value: ['private'],
      }),
    );
    fireEvent.click(arrow);
    expect(arrow).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('My notes')).toBeInTheDocument();
  });

  it('opens a database into its views from the Databases lane', async () => {
    renderSidebar();
    const rota = await screen.findByRole('treeitem', { name: 'Rota' });
    expect(rota).toHaveAttribute('aria-expanded', 'false');
    fireEvent.focus(rota);
    fireEvent.keyDown(rota, { key: 'ArrowRight' });
    expect(await screen.findByText('Views of Rota')).toBeInTheDocument();
  });

  it('shows Recent from a heading menu, and clears it', async () => {
    renderSidebar();
    fireEvent.contextMenu(await screen.findByRole('heading', { name: 'Private' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Show Recent' }));
    const recent = await screen.findByRole('group', { name: 'Recent' });
    expect(await within(recent).findByRole('link', { name: 'Week one' })).toHaveAttribute(
      'href',
      '/p/a2',
    );
    fireEvent.contextMenu(within(recent).getByRole('heading', { name: 'Recent' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clear recent' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Recent' })).toBeNull());
    expect(api.delete).toHaveBeenCalledWith('/api/recent');
  });

  it('offers Retry when the pages fail to load', async () => {
    renderSidebar({ '/api/spaces': new Error('offline') });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    api.get.mockResolvedValueOnce({ spaces });
    fireEvent.click(retry);
    expect(await screen.findByRole('group', { name: 'Spaces' })).toBeInTheDocument();
  });

  it('adds a page to a space with "+" and opens it', async () => {
    renderSidebar();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a page to General' }));
    expect(await screen.findByText('Opened new1')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/pages', {
      kind: 'page',
      title: '',
      spaceId: 'general',
    });
  });

  it('offers "Add a page" while Private is empty', async () => {
    renderSidebar({ '/api/spaces/mine/tree': { nodes: [] } });
    const add = await within(await screen.findByRole('group', { name: 'Private' })).findByRole(
      'button',
      { name: 'Add a page' },
    );
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/pages', {
        kind: 'page',
        title: '',
        spaceId: 'mine',
      }),
    );
  });

  it("hides adding pages from someone whose role can't create them", async () => {
    renderSidebar({ '/api/auth/me': { member: { permissions: [] } } });
    expect(await screen.findByRole('tree', { name: 'General' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a page to General' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a page to Private' })).toBeNull();
  });
});
