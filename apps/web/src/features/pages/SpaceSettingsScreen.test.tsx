import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceSettingsScreen } from './SpaceSettingsScreen';
import type { SpaceSettings } from './space-settings';

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

// Radix measures itself; jsdom can't.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// A fictional space, as its owner sees it.
const care: SpaceSettings = {
  id: 'care',
  kind: 'closed',
  name: 'Care team',
  icon: null,
  description: 'Rotas and handovers.',
  defaultAccess: 'edit',
  topLevel: 'members',
  security: { shareLinks: true, guests: false, export: true, moveOut: true },
  workspaceAllows: { shareLinks: true, guests: true, export: true, moveOut: true },
  canManage: true,
};

function show(reply: unknown = { space: care }) {
  api.get.mockImplementation(async (path) => {
    if (reply instanceof Error) throw reply;
    if (path === '/api/spaces/care') return reply;
    throw new Error(`Unexpected GET ${path}`);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/spaces/care/settings']}>
        <Routes>
          <Route path="/spaces/:spaceId/settings" element={<SpaceSettingsScreen />} />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const nameField = () => screen.findByRole('textbox', { name: /^Name/ });

beforeEach(() => {
  vi.clearAllMocks();
  api.patch.mockResolvedValue(null);
});

describe('SpaceSettingsScreen', () => {
  it("shows the space's settings to its owners", async () => {
    show();
    expect(await nameField()).toHaveValue('Care team');
    expect(screen.getByRole('heading', { level: 1, name: 'Space settings' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Rotas and handovers.',
    );
    expect(screen.getByRole('radio', { name: 'Closed' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Default access for members' })).toHaveTextContent(
      'Can edit',
    );
    expect(
      screen.getByRole('combobox', { name: 'Who can add pages at the top level' }),
    ).toHaveTextContent('All members');
    expect(screen.getByRole('switch', { name: 'Allow share links' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Allow guests on its pages' })).not.toBeChecked();
  });

  it('renames the space on Enter, once', async () => {
    show();
    const name = await nameField();
    fireEvent.change(name, { target: { value: '  Care and support ' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/spaces/care', { name: 'Care and support' }),
    );
    fireEvent.blur(name);
    expect(name).toHaveValue('Care and support');
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('says when another space has the name, keeping what was typed', async () => {
    api.patch.mockRejectedValue(new Refused(409, 'Name taken'));
    show();
    const name = await nameField();
    fireEvent.change(name, { target: { value: 'General' } });
    fireEvent.blur(name);
    expect(
      await screen.findByText("There's already a space called “General”."),
    ).toBeInTheDocument();
    expect(name).toHaveValue('General');
    fireEvent.blur(name);
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('needs a name', async () => {
    show();
    const name = await nameField();
    fireEvent.change(name, { target: { value: ' ' } });
    fireEvent.blur(name);
    expect(await screen.findByText('Give the space a name.')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('saves the description on leaving it', async () => {
    show();
    const description = await screen.findByRole('textbox', { name: 'Description' });
    fireEvent.change(description, { target: { value: 'Rotas, handovers and leave.' } });
    fireEvent.blur(description);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/spaces/care', {
        description: 'Rotas, handovers and leave.',
      }),
    );
  });

  it('changes who can find it', async () => {
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'Private' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/spaces/care', { kind: 'private' }),
    );
    expect(screen.getByRole('radio', { name: 'Private' })).toBeChecked();
  });

  it('saves a switch at once, and puts it back if the server refuses', async () => {
    api.patch.mockRejectedValue(new Refused(400, 'Not now.'));
    show();
    const exporting = await screen.findByRole('switch', { name: 'Allow export' });
    fireEvent.click(exporting);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/spaces/care', { security: { export: false } }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Couldn't change the setting.",
        description: 'Not now.',
        variant: 'danger',
      }),
    );
    expect(exporting).toBeChecked();
  });

  it('keeps off what the workspace turns off', async () => {
    show({ space: { ...care, workspaceAllows: { ...care.workspaceAllows, guests: false } } });
    const guests = await screen.findByRole('switch', { name: 'Allow guests on its pages' });
    expect(guests).toBeDisabled();
    expect(guests).toHaveAccessibleDescription(
      'Turned off for the whole workspace. An Admin can change that.',
    );
  });

  it('archives the space after the confirm, then goes Home', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive space' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Archive “Care team”?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive space' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/spaces/care', { archived: true }),
    );
    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it("tells someone who can't manage the space", async () => {
    show({ space: { ...care, canManage: false } });
    expect(
      await screen.findByRole('heading', { name: "You can't change this space" }),
    ).toBeInTheDocument();
  });

  it("says when the space isn't there", async () => {
    show(new Refused(404, 'Not found'));
    expect(
      await screen.findByRole('heading', { name: "This space isn't here" }),
    ).toBeInTheDocument();
  });

  it('offers Retry when the settings fail to load', async () => {
    show(new Error('offline'));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    api.get.mockResolvedValue({ space: care });
    fireEvent.click(retry);
    expect(await nameField()).toHaveValue('Care team');
  });
});
