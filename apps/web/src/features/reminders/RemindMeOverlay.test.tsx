import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RemindMeTarget } from './choices';
import { closeRemindMe, openRemindMe, pageIdIn } from './remindMe';
import { RemindMeOverlay } from './RemindMeOverlay';

const PAGE_ID = '3e7a9c14-6b2d-4f58-a0e1-8c4d2b6f9a73';
const EVENT_ID = 'f2b8d6a0-4c1e-4a93-b7d5-1e9c3a5f7b28';

const page: RemindMeTarget = { type: 'page', pageId: PAGE_ID, title: 'Visit checklist' };
const visit: RemindMeTarget = {
  type: 'event',
  eventId: EVENT_ID,
  title: 'Home visit',
  allDay: false,
  // Far enough ahead that every preset is still to come.
  start: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  closeRemindMe();
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input) !== '/api/auth/me') return new Response(null, { status: 404 });
    const body = { user: { timeZone: 'America/Chicago', use24h: false } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderWith(opener: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        {opener}
        <RemindMeOverlay />
      </QueryClientProvider>
    </ToastProvider>,
  );
}

/** Focuses `button` and clicks it, as a keyboard user does. */
function press(button: HTMLElement) {
  button.focus();
  fireEvent.click(button);
}

async function closeWithEscape() {
  const dialog = await screen.findByRole('dialog', { name: 'Remind me' });
  await within(dialog).findByRole('menu', { name: 'Remind me' });
  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('RemindMeOverlay', () => {
  it('opens for an event from a button, and gives focus back to it on Escape', async () => {
    renderWith(
      <button type="button" onClick={() => openRemindMe(visit)}>
        Remind me
      </button>,
    );
    const button = screen.getByRole('button', { name: 'Remind me' });
    press(button);

    const dialog = await screen.findByRole('dialog', { name: 'Remind me' });
    expect(within(dialog).getByText('Home visit')).toBeInTheDocument();
    expect(await within(dialog).findByRole('menuitem', { name: 'At the start' })).toHaveFocus();
    await closeWithEscape();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('gives focus back to the button that opened the menu it was picked from', async () => {
    renderWith(
      <>
        <button type="button" aria-label="Page actions" aria-controls="page-actions">
          …
        </button>
        <div role="menu" id="page-actions">
          <button type="button" role="menuitem" onClick={() => openRemindMe(page)}>
            Remind me
          </button>
        </div>
      </>,
    );
    press(screen.getByRole('menuitem', { name: 'Remind me' }));

    const dialog = await screen.findByRole('dialog', { name: 'Remind me' });
    expect(within(dialog).getByText('Visit checklist')).toBeInTheDocument();
    await closeWithEscape();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Page actions' })).toHaveFocus());
  });

  it("says where Remind me is when there's nothing to remind about", async () => {
    renderWith(
      <button type="button" onClick={() => openRemindMe(null)}>
        Open
      </button>,
    );
    press(screen.getByRole('button', { name: 'Open' }));

    const dialog = await screen.findByRole('dialog', { name: 'Remind me' });
    expect(
      within(dialog).getByText("Open a page first, or use Remind me in an event's panel."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('pageIdIn', () => {
  it('finds the page in a page address only', () => {
    expect(pageIdIn(`/p/${PAGE_ID}`)).toBe(PAGE_ID);
    expect(pageIdIn(`/p/${PAGE_ID}/`)).toBe(PAGE_ID);
    expect(pageIdIn('/calendar')).toBeNull();
    expect(pageIdIn('/p/visit-checklist')).toBeNull();
    expect(pageIdIn(`/p/${PAGE_ID}/history`)).toBeNull();
  });
});
