import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSlots } from '../../slots';
import { resetAppStart } from './app-start';
import { RequireAuth } from './require-auth';
import { fakeAuthServer, json, meFor, renderRoutes, restoreFetch, USER } from './test-utils';

afterEach(async () => {
  restoreFetch();
  resetAppStart();
  await loadSlots([]);
});

function renderGuarded(path: string, required: boolean) {
  return renderRoutes(
    <>
      <Route path="/sign-in" element={<p>Sign-in screen</p>} />
      <Route
        path="*"
        element={
          <RequireAuth required={required}>
            <p>Signed-in screen</p>
          </RequireAuth>
        }
      />
    </>,
    { path },
  );
}

describe('RequireAuth', () => {
  it('shows the screen to the person signed in and runs the app start items once', async () => {
    fakeAuthServer(meFor());
    const run = vi.fn();
    await loadSlots([async () => ({ slots: { appStart: [{ id: 'push', run }] } })]);

    const view = renderGuarded('/p/page-1', true);
    expect(await screen.findByText('Signed-in screen')).toBeVisible();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ user: USER, navigate: expect.any(Function) }),
    );

    // Back from a signed-out screen: still the same sign-in, so nothing runs again.
    view.unmount();
    renderGuarded('/p/page-1', true);
    expect(await screen.findByText('Signed-in screen')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sends someone signed out to sign in, to come back to the same address', async () => {
    fakeAuthServer(null);
    const run = vi.fn();
    await loadSlots([async () => ({ slots: { appStart: [{ id: 'push', run }] } })]);

    renderGuarded('/p/page-1?view=table#block-2', true);
    expect(await screen.findByText('Sign-in screen')).toBeVisible();
    expect(screen.getByTestId('address')).toHaveTextContent(
      '/sign-in?next=%2Fp%2Fpage-1%3Fview%3Dtable%23block-2',
    );
    expect(screen.queryByText('Signed-in screen')).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it('shows the screen at once, signed out too, while sign-in is not required', async () => {
    const server = fakeAuthServer(null);
    renderGuarded('/p/page-1', false);
    expect(screen.getByText('Signed-in screen')).toBeVisible();
    await waitFor(() => expect(server.requests).toHaveLength(1));
    expect(screen.getByText('Signed-in screen')).toBeVisible();
    expect(screen.getByTestId('address')).toHaveTextContent('/p/page-1');
  });

  it('waits in a main landmark, and offers Retry when the person could not be loaded', async () => {
    const server = fakeAuthServer(meFor(), {
      'GET /api/auth/me': () =>
        json(503, { error: { code: 'unavailable', message: 'Care Hub is restarting.' } }),
    });
    renderGuarded('/', true);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByText('Signed-in screen')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Care Hub is restarting.');

    delete server.routes['GET /api/auth/me'];
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Signed-in screen')).toBeVisible();
  });
});
