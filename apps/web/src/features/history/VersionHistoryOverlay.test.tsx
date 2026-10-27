import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import { slots } from './slots';
import { closeVersionHistory, currentVersionHistory } from './store';
import { fakeHistoryServer, fakeVersion, PAGE } from './testServer';
import { VersionHistoryOverlay } from './VersionHistoryOverlay';

const realFetch = globalThis.fetch;
let navigate: NavigateFunction = () => undefined;

function Navigator() {
  navigate = useNavigate();
  return null;
}

function renderOverlay() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/p/${PAGE.id}`]}>
          <Navigator />
          <VersionHistoryOverlay />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const menuItem = () => {
  const item = slots.pageMenuItems?.find((one) => one.id === 'history.versions');
  if (!item) throw new Error('No Version history menu item.');
  return item;
};

beforeEach(() => {
  globalThis.fetch = fakeHistoryServer([fakeVersion('v-1', 5, 'Call the member.')]).fetch;
  setLiveClientForTest(createFakeLive().client);
});

afterEach(() => {
  act(() => closeVersionHistory());
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

describe('the Version history window', () => {
  it('is in the page menu of pages and rows, not databases', () => {
    expect(menuItem().label).toBe('Version history');
    expect(menuItem().isVisible?.(PAGE)).toBe(true);
    expect(menuItem().isVisible?.({ ...PAGE, kind: 'row' })).toBe(true);
    expect(menuItem().isVisible?.({ ...PAGE, kind: 'database' })).toBe(false);
  });

  it('opens from the page menu with the page title, and Esc closes it', async () => {
    renderOverlay();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => menuItem().onSelect(PAGE));
    const dialog = await screen.findByRole('dialog', { name: 'Version history' });
    expect(dialog).toHaveAccessibleDescription('Refund steps');
    expect(await screen.findByRole('listbox', { name: 'Versions' })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(currentVersionHistory()).toBeNull();
  });

  it('closes when the person goes to another screen', async () => {
    renderOverlay();
    act(() => menuItem().onSelect(PAGE));
    await screen.findByRole('dialog', { name: 'Version history' });

    act(() => {
      void navigate('/p/page-other');
    });
    expect(currentVersionHistory()).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
