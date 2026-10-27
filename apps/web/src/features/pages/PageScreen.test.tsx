import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderTargetContext } from '../shell/header-context';
import { PageScreen } from './PageScreen';

const { api, toast, Refused, editor, slots } = vi.hoisted(() => {
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
  return {
    api: {
      get: vi.fn<(path: string) => Promise<unknown>>(),
      post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      put: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      patch: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      delete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
    },
    toast: vi.fn(),
    Refused,
    editor: { isEmpty: true, commands: { focus: vi.fn() }, on: vi.fn(), off: vi.fn() },
    slots: {
      pageKindViews: {},
      pageHeaderExtras: {},
      pageMenuItems: [],
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
const policies = { id: 'policies', kind: 'page', title: 'Policies', icon: null };

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
}

const titleField = () => screen.findByRole('textbox', { name: 'Page title' });
const topBar = () => screen.getByRole('banner');

beforeEach(() => {
  vi.clearAllMocks();
  editor.isEmpty = true;
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
    if (path === '/api/auth/me') return { member: { permissions: ['pages.create'] } };
    return {};
  });
  api.patch.mockImplementation(async (path, body) => {
    const id = path.slice('/api/pages/'.length);
    const { locked, archived, ...rest } = body as Record<string, unknown>;
    const page = { ...pages.get(id), ...rest };
    if (locked === false) page.lockedAt = undefined;
    if (archived === false) page.archivedAt = undefined;
    pages.set(id, page);
    return null;
  });
  api.post.mockImplementation(async (path) => {
    const id = /^\/api\/trash\/([^/]+)\/restore$/.exec(path)?.[1];
    if (id) pages.set(id, { ...pages.get(id), deletedAt: undefined });
    return null;
  });
  api.put.mockResolvedValue(null);
  api.delete.mockResolvedValue(null);
});

describe('PageScreen', () => {
  it('shows the breadcrumbs, title, icon, tab title and when the page was edited', async () => {
    open('refunds');
    expect(await titleField()).toHaveValue('Refund steps');
    expect(document.title).toBe('Care Hub · 🚀 Refund steps');
    expect(screen.getByRole('img', { name: 'Page icon' })).toHaveTextContent('🚀');
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

  it('shows an archived page read-only, and Unarchive brings it back', async () => {
    pages.set('refunds', refunds({ archivedAt: '2026-10-20T15:00:00Z', archivedBy: sam }));
    open('refunds');
    expect(await screen.findByText('Archived by Sam Ortiz on Oct 20, 2026')).toBeInTheDocument();
    expect(await titleField()).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(screen.queryByText(/^Archived by/)).not.toBeInTheDocument());
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
