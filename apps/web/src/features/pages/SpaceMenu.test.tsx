import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateSpaceButton, SpaceMenu } from './SpaceMenu';
import type { Space } from './types';

const { api, toast, Refused } = vi.hoisted(() => {
  /** Stands in for ApiError. */
  class Refused extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    api: {
      get: vi.fn<(path: string) => Promise<unknown>>(),
      post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      patch: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
      delete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
    },
    toast: vi.fn(),
    Refused,
  };
});
vi.mock('../../lib/api', () => ({ api, ApiError: Refused }));
vi.mock('@carehub/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@carehub/ui')>()),
  useToast: () => ({ toast }),
}));

// Radix menus measure themselves; jsdom can't.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Fictional spaces.
const general: Space = { id: 'general', kind: 'open', name: 'General', icon: null };
const billing: Space = { id: 'billing', kind: 'closed', name: 'Billing', icon: null };
const leaders: Space = { id: 'leaders', kind: 'private', name: 'Team leads', icon: null };

function show(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {children}
        <Routes>
          <Route path="/spaces/:spaceId/settings" element={<p>Settings opened</p>} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens the space's "…", as the keyboard does. */
function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `${name} options` }), { key: 'Enter' });
  return screen.findByRole('menu');
}

const itemsOf = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);

/** Picks a menu item; its confirm opens once the menu has closed. */
async function choose(space: string, item: string, title: string) {
  fireEvent.click(within(await openMenu(space)).getByRole('menuitem', { name: item }));
  return screen.findByRole('alertdialog', { name: title });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ space: { id: 'general', pageCount: 12 } });
  api.post.mockResolvedValue(null);
  api.patch.mockResolvedValue(null);
  api.delete.mockResolvedValue(null);
});

describe('SpaceMenu', () => {
  it('offers Leave in Open and Closed spaces, and Archive and Delete to owners', async () => {
    show(
      <>
        <SpaceMenu space={general} />
        <SpaceMenu space={{ ...billing, canManage: true }} />
        <SpaceMenu space={leaders} />
      </>,
    );
    expect(itemsOf(await openMenu('General'))).toEqual(['Leave space']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(itemsOf(await openMenu('Billing'))).toEqual([
      'Space settings',
      'Leave space',
      'Archive space',
      'Delete space',
    ]);
    // Members can't leave a Private space; with nothing to offer, it has no "…".
    expect(screen.queryByRole('button', { name: 'Team leads options' })).not.toBeInTheDocument();
  });

  it("opens the space's settings for owners", async () => {
    show(<SpaceMenu space={{ ...billing, canManage: true }} />);
    fireEvent.click(
      within(await openMenu('Billing')).getByRole('menuitem', { name: 'Space settings' }),
    );
    expect(await screen.findByText('Settings opened')).toBeInTheDocument();
  });

  it("moves the space up or down in the person's order, where it can go", async () => {
    const up = vi.fn();
    show(<SpaceMenu space={leaders} moves={{ up }} />);
    // Even in a Private space, someone who can't manage it may put it elsewhere in their sidebar.
    const menu = await openMenu('Team leads');
    expect(itemsOf(menu)).toEqual(['Move up']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move up' }));
    expect(up).toHaveBeenCalledTimes(1);
  });

  it('keeps the order moves apart from Leave', async () => {
    show(<SpaceMenu space={general} moves={{ up: vi.fn(), down: vi.fn() }} />);
    const menu = await openMenu('General');
    expect(itemsOf(menu)).toEqual(['Move up', 'Move down', 'Leave space']);
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
  });

  it('leaves the space after the confirm', async () => {
    show(<SpaceMenu space={billing} />);
    const dialog = await choose('Billing', 'Leave space', 'Leave “Billing”?');
    expect(dialog).toHaveTextContent("To come back, you'll need an owner's OK.");
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave space' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/spaces/billing/leave'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: 'You left “Billing”.', variant: 'success' }),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it("says why the last owner can't leave", async () => {
    api.post.mockRejectedValue(new Refused(409, 'Last owner'));
    show(<SpaceMenu space={{ ...general, canManage: true }} />);
    const dialog = await choose('General', 'Leave space', 'Leave “General”?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave space' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "You're the last owner of “General”." }),
      ),
    );
  });

  it('archives the space after the confirm', async () => {
    show(<SpaceMenu space={{ ...general, canManage: true }} />);
    const dialog = await choose('General', 'Archive space', 'Archive “General”?');
    expect(dialog).toHaveTextContent('Admins can unarchive it in Settings → Spaces.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive space' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/spaces/general', { archived: true }),
    );
  });

  it('says how many pages go to Trash with a deleted space', async () => {
    show(<SpaceMenu space={{ ...general, canManage: true }} />);
    const dialog = await choose('General', 'Delete space', 'Delete “General”?');
    expect(
      await within(dialog).findByText('The space and its 12 pages move to Trash.'),
    ).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/spaces/general');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete space' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/spaces/general'));
    expect(toast).toHaveBeenCalledWith({ title: 'Moved “General” to Trash.', variant: 'success' });
  });

  it('keeps the space when the confirm is cancelled', async () => {
    show(<SpaceMenu space={{ ...general, canManage: true }} />);
    const dialog = await choose('General', 'Delete space', 'Delete “General”?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.delete).not.toHaveBeenCalled();
  });
});

describe('CreateSpaceButton', () => {
  const openDialog = () => {
    show(<CreateSpaceButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Create space' }));
    return screen.findByRole('dialog', { name: 'Create a space' });
  };

  it('creates a space with a name, description, kind and Can edit for members', async () => {
    const dialog = await openDialog();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(name).toHaveFocus());
    fireEvent.change(name, { target: { value: '  Billing  ' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Invoices and refunds.' },
    });
    expect(within(dialog).getByRole('radio', { name: 'Open' })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Closed' }));
    expect(
      within(dialog).getByRole('combobox', { name: 'Default access for members' }),
    ).toHaveTextContent('Can edit');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create space' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/spaces', {
        name: 'Billing',
        icon: null,
        description: 'Invoices and refunds.',
        kind: 'closed',
        defaultAccess: 'edit',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith({ title: 'Created “Billing”.', variant: 'success' });
  });

  it('needs a name', async () => {
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create space' }));
    expect(await within(dialog).findByText('Give the space a name.')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says when the name is taken, and stays open', async () => {
    api.post.mockRejectedValue(new Refused(409, 'Taken'));
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'General' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create space' }));
    expect(
      await within(dialog).findByText("There's already a space called “General”."),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Create a space' })).toBeInTheDocument();
  });

  it("says so when the workspace doesn't let the person create spaces", async () => {
    api.post.mockRejectedValue(new Refused(403, 'Forbidden'));
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Billing' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create space' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "You can't create spaces in this workspace. An Admin can change that.",
    );
  });
});
