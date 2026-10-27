import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSlots } from '../../slots';
import { meQueryKey } from '../auth';
import {
  changes,
  createTestQueryClient,
  fakeAuthServer,
  json,
  meFor,
  renderRoutes,
  restoreFetch,
  USER,
} from '../auth/test-utils';
import { WorkspaceMenu } from './workspace-menu';

// jsdom has no ResizeObserver; the open menu measures itself.
beforeAll(() => {
  window.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as unknown as typeof ResizeObserver;
});

afterEach(async () => {
  restoreFetch();
  await loadSlots([]);
});

const VIEWER = ['comments', 'viewer'];

function renderMenu(onNavigate?: () => void) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(meQueryKey, meFor());
  queryClient.setQueryData(VIEWER, { id: USER.id });
  renderRoutes(
    <>
      <Route path="/sign-in" element={<p>Sign-in screen</p>} />
      <Route path="*" element={<WorkspaceMenu onNavigate={onNavigate} />} />
    </>,
    { queryClient },
  );
  return queryClient;
}

async function choose(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Care Hub' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

describe('WorkspaceMenu', () => {
  it('opens Settings', async () => {
    fakeAuthServer(meFor());
    const onNavigate = vi.fn();
    renderMenu(onNavigate);
    const trigger = screen.getByRole('button', { name: 'Care Hub' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    await choose('Settings');
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/settings'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('signs out: beforeSignOut, the server, the signOut hooks, then the cache goes', async () => {
    const order: string[] = [];
    const server = fakeAuthServer(meFor(), {
      'POST /api/auth/sign-out': () => {
        order.push('server');
        return json(200, { ok: true });
      },
    });
    const queryClient = renderMenu();
    const before = vi.fn(() => {
      order.push('before');
    });
    const run = vi.fn(() => {
      order.push(queryClient.getQueryData(VIEWER) ? 'hook, cache kept' : 'hook, cache gone');
    });
    await loadSlots([
      async () => ({
        slots: { beforeSignOut: [{ id: 'push', run: before }], signOut: [{ id: 'queue', run }] },
      }),
    ]);

    await choose('Sign out');
    expect(await screen.findByText('Sign-in screen')).toBeVisible();
    expect(screen.getByTestId('address')).toHaveTextContent(/^\/sign-in$/);
    expect(changes(server)).toEqual(['POST /api/auth/sign-out']);
    expect(order).toEqual(['before', 'server', 'hook, cache kept']);
    expect(before).toHaveBeenCalledWith(expect.objectContaining({ user: USER }));
    expect(run).toHaveBeenCalledWith({ user: USER });
    expect(queryClient.getQueryData(VIEWER)).toBeUndefined();
    expect(queryClient.getQueryData(meQueryKey)).toBeUndefined();
  });

  it("stays signed in and says so when the server can't be reached", async () => {
    fakeAuthServer(meFor(), {
      'POST /api/auth/sign-out': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const run = vi.fn();
    await loadSlots([async () => ({ slots: { signOut: [{ id: 'push', run }] } })]);
    const queryClient = renderMenu();

    await choose('Sign out');
    expect((await screen.findAllByText("Couldn't sign out")).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Can't reach Care Hub. Check your connection, then try again.").length,
    ).toBeGreaterThan(0);
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId('address')).toHaveTextContent(/^\/$/);
    expect(queryClient.getQueryData(VIEWER)).toEqual({ id: USER.id });
  });
});
