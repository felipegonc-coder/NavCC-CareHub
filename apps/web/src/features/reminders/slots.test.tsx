import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewReminder } from './api';
import { closeRemindMe } from './remindMe';
import { slots } from './slots';

const PAGE_ID = '8a4c2e60-1f3b-4d7a-9e25-b6c0d8f4a192';
const REMINDER_ID = '0c6e8a24-5b7d-4f19-a3c1-e2d4f6b8a057';

type Call = { method: string; path: string; body: unknown };

const realFetch = globalThis.fetch;
let calls: Call[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  closeRemindMe();
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { method: init?.method ?? 'GET', path: String(input), body };
    calls.push(call);
    if (call.path === '/api/auth/me') {
      return json(200, { user: { timeZone: 'America/New_York', use24h: false } });
    }
    if (call.method !== 'POST' || call.path !== '/api/reminders') return json(404, {});
    const sent = call.body as NewReminder;
    const at = 'at' in sent ? sent.at : new Date().toISOString();
    return json(201, {
      reminder: {
        id: REMINDER_ID,
        target: sent.target,
        title: 'Medication rounds',
        href: `/p/${PAGE_ID}`,
        minutesBefore: null,
        dueAt: at,
        note: '',
        status: 'pending',
        sentAt: null,
        createdAt: new Date().toISOString(),
      },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  window.history.pushState({}, '', '/');
});

function renderOverlays() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        {slots.overlays?.map(({ id, Component }) => (
          <Component key={id} />
        ))}
      </QueryClientProvider>
    </ToastProvider>,
  );
}

const command = () => slots.commands?.find((each) => each.title === 'Remind me');

describe('Reminders slots', () => {
  it('puts Remind me in the "…" menu of a page or row', async () => {
    renderOverlays();
    const item = slots.pageMenuItems?.find((each) => each.label === 'Remind me');
    act(() => item?.onSelect({ id: PAGE_ID, kind: 'row', title: 'Medication rounds' }));

    const dialog = await screen.findByRole('dialog', { name: 'Remind me' });
    expect(within(dialog).getByText('Medication rounds')).toBeInTheDocument();
    expect(await within(dialog).findByRole('menuitem', { name: 'In 1 hour' })).toHaveFocus();
  });

  it('finds Remind me in Ctrl+K by "remind", for the page that is open', async () => {
    window.history.pushState({}, '', `/p/${PAGE_ID}`);
    renderOverlays();
    expect(command()?.keywords).toContain('remind');
    act(() => void command()?.run({ navigate: () => {} }));

    const dialog = await screen.findByRole('dialog', { name: 'Remind me' });
    expect(within(dialog).getByText('This page')).toBeInTheDocument();
    fireEvent.click(await within(dialog).findByRole('menuitem', { name: 'In 1 hour' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({ target: { type: 'page', pageId: PAGE_ID } });
  });

  it('says where Remind me is when Ctrl+K opens it away from a page', async () => {
    window.history.pushState({}, '', '/calendar');
    renderOverlays();
    act(() => void command()?.run({ navigate: () => {} }));

    const dialog = await screen.findByRole('dialog', { name: 'Remind me' });
    expect(
      within(dialog).getByText("Open a page first, or use Remind me in an event's panel."),
    ).toBeInTheDocument();
  });
});
