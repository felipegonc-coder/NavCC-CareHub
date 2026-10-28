import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import type { Reminder, ReminderList } from './api';
import { usePendingReminders } from './hooks';
import { RemindersScreen } from './RemindersScreen';
import { routes } from './routes';

const PAGE_ID = '5d1f0a52-8f1e-4c4b-9a52-0d6a3c1e7b10';
const EVENT_ID = '9b2c6e41-3d7a-4f0e-8c15-6a4e2f9d1c37';
const ID = 'c0a8f3e2-1b4d-4e6f-9a7c-2d5e8f1a3b60';

const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: ID,
  target: { type: 'page', pageId: PAGE_ID },
  title: 'Shift handover',
  href: `/p/${PAGE_ID}`,
  minutesBefore: null,
  dueAt: '2026-10-27T21:30:00.000Z', // 3:30 PM in Denver
  note: 'Check the queue',
  status: 'pending',
  sentAt: null,
  createdAt: '2026-10-26T15:00:00.000Z',
  ...overrides,
});

const standup = (overrides: Partial<Reminder> = {}): Reminder =>
  reminder({
    id: '7e3d9a10-5b2c-4f8e-a1d6-3c9b0e7f2a45',
    target: { type: 'event', eventId: EVENT_ID },
    title: 'Team standup',
    href: `/calendar?event=${EVENT_ID}`,
    minutesBefore: 10,
    dueAt: '2026-10-28T15:50:00.000Z', // 10 minutes before 10:00 AM tomorrow
    note: '',
    ...overrides,
  });

type Call = { method: string; path: string; body: unknown };
type Answer = { status: number; body?: unknown };

const realFetch = globalThis.fetch;
let calls: Call[];
let list: ReminderList;
let answer: ((call: Call) => Answer | undefined) | undefined;
let live: ReturnType<typeof createFakeLive>;

function respond({ status, body }: Answer): Response {
  if (body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fake Reminders API over `list`. */
function serve(call: Call): Answer {
  if (call.path === '/api/auth/me') {
    return { status: 200, body: { user: { timeZone: 'America/Denver', use24h: false } } };
  }
  if (call.path === '/api/reminders') return { status: 200, body: list };
  const id = call.path.split('/').pop();
  const found = list.pending.find((each) => each.id === id);
  if (!found) return { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
  if (call.method === 'DELETE') {
    list = { ...list, pending: list.pending.filter((each) => each !== found) };
    return { status: 204 };
  }
  const change = call.body as { at?: string; minutesBefore?: number; note?: string };
  const changed = {
    ...found,
    ...(change.at === undefined ? {} : { dueAt: change.at }),
    ...(change.minutesBefore === undefined ? {} : { minutesBefore: change.minutesBefore }),
    ...(change.note === undefined ? {} : { note: change.note }),
  };
  list = { ...list, pending: list.pending.map((each) => (each === found ? changed : each)) };
  return { status: 200, body: { reminder: changed } };
}

beforeEach(() => {
  // Tuesday, Oct 27, 2026, 9:00 AM in Denver. Only Date is faked; timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T15:00:00.000Z'));
  calls = [];
  list = { pending: [], sent: [] };
  answer = undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { method: init?.method ?? 'GET', path: String(input), body };
    calls.push(call);
    return respond(answer?.(call) ?? serve(call));
  }) as typeof fetch;
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
});

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderScreen() {
  return render(
    <ToastProvider>
      <QueryClientProvider client={newClient()}>
        <MemoryRouter>
          <RemindersScreen />
        </MemoryRouter>
      </QueryClientProvider>
    </ToastProvider>,
  );
}

const patches = () => calls.filter((call) => call.method === 'PATCH');
const deletes = () => calls.filter((call) => call.method === 'DELETE');

async function openEdit(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Edit reminder: ${name}` }));
  return screen.findByRole('dialog', { name: 'Change reminder' });
}

async function save(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('RemindersScreen', () => {
  it('lists pending reminders soonest first and the sent ones, with times and notes', async () => {
    list = {
      pending: [
        reminder(),
        standup(),
        reminder({
          id: '2f6b8c4d-9e1a-4d3b-8f7c-5a0e6d2b9c18',
          title: null,
          status: 'snoozed',
          dueAt: '2026-10-29T16:00:00.000Z',
          note: 'Call Bluebird Bakery',
        }),
        standup({
          id: '4a9e2c7b-1d3f-4b6a-9c8e-7f0d5b3a1e62',
          title: 'Fictional site visit',
          minutesBefore: -540,
          dueAt: '2026-10-30T15:00:00.000Z',
        }),
      ],
      sent: [
        reminder({
          id: '8d0c5e3a-6f2b-4a9d-b7e1-0c4f9a6d2b37',
          title: 'Northwind Tiles order',
          status: 'done',
          dueAt: '2026-10-26T16:00:00.000Z',
          sentAt: '2026-10-26T16:00:20.000Z',
          note: '',
        }),
      ],
    };
    renderScreen();

    const pending = await screen.findByRole('region', { name: 'Pending' });
    const items = within(pending).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    const [first, second, third, fourth] = items as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(within(first).getByRole('link', { name: 'Shift handover' })).toHaveAttribute(
      'href',
      `/p/${PAGE_ID}`,
    );
    expect(first).toHaveTextContent('Today at 3:30 PM');
    expect(first).toHaveTextContent('Check the queue');
    expect(second).toHaveTextContent('Tomorrow at 9:50 AM · 10 minutes before');
    expect(third).toHaveTextContent("A page you can't open");
    expect(within(third).queryByRole('link')).toBeNull();
    expect(third).toHaveTextContent('Snoozed until Thu, Oct 29 at 10:00 AM');
    expect(fourth).toHaveTextContent('Fri, Oct 30 at 9:00 AM · On the day at 9:00 AM');

    const sent = screen.getByRole('region', { name: 'Sent in the last 30 days' });
    expect(within(sent).getByRole('listitem')).toHaveTextContent(
      'Sent yesterday at 10:00 AM · Done',
    );
    expect(within(sent).queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Reminders' })).toBeInTheDocument();
    expect(document.title).toBe('Care Hub · Reminders');
  });

  it('says so when there are none', async () => {
    renderScreen();
    expect(
      await screen.findByText('No reminders. Use Remind me on a page or event.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No reminders sent in the last 30 days.')).toBeInTheDocument();
  });

  it('shows what went wrong, and Retry loads them', async () => {
    let failing = true;
    answer = (call) =>
      failing && call.path === '/api/reminders'
        ? { status: 500, body: { error: { code: 'unexpected', message: 'Something broke.' } } }
        : undefined;
    renderScreen();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke.');

    failing = false;
    list = { pending: [reminder()], sent: [] };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Shift handover' })).toBeInTheDocument();
  });

  it('changes only the note when only the note changed', async () => {
    list = { pending: [reminder()], sent: [] };
    renderScreen();
    const dialog = await openEdit('Shift handover');
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-10-27');
    expect(within(dialog).getByLabelText('Time')).toHaveValue('15:30');
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: 'Check the queue twice' },
    });
    await save(dialog);

    expect(patches()).toEqual([
      { method: 'PATCH', path: `/api/reminders/${ID}`, body: { note: 'Check the queue twice' } },
    ]);
    expect(await screen.findByText('Check the queue twice')).toBeInTheDocument();
    expect(await screen.findByText('Reminder changed')).toBeInTheDocument();
  });

  it('moves a page reminder to the date and time entered, in the person’s time zone', async () => {
    list = { pending: [reminder()], sent: [] };
    renderScreen();
    const dialog = await openEdit('Shift handover');
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-10-28' } });
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '17:00' } });
    await save(dialog);

    expect(patches().map((call) => call.body)).toEqual([{ at: '2026-10-28T23:00:00.000Z' }]);
    expect(await screen.findByText('Tomorrow at 5:00 PM')).toBeInTheDocument();
  });

  it('changes only the note of an event reminder, whose time goes with the event', async () => {
    list = { pending: [standup()], sent: [] };
    renderScreen();
    const dialog = await openEdit('Team standup');
    expect(within(dialog).queryByLabelText('Date')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Note'), {
      target: { value: 'Bring the notes' },
    });
    await save(dialog);

    expect(patches().map((call) => call.body)).toEqual([{ note: 'Bring the notes' }]);
  });

  it('shows the server’s reason in the dialog when a change is refused', async () => {
    list = { pending: [reminder()], sent: [] };
    answer = (call) =>
      call.method === 'PATCH'
        ? {
            status: 409,
            body: {
              error: {
                code: 'conflict',
                message: 'This reminder was already sent. Set a new one instead.',
              },
            },
          }
        : undefined;
    renderScreen();
    const dialog = await openEdit('Shift handover');
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Too late' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This reminder was already sent. Set a new one instead.',
    );
    expect(screen.getByRole('dialog', { name: 'Change reminder' })).toBeInTheDocument();
  });

  it('closes without a request on Cancel, with focus back on Edit', async () => {
    list = { pending: [reminder()], sent: [] };
    renderScreen();
    const dialog = await openEdit('Shift handover');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patches()).toEqual([]);
    const edit = screen.getByRole('button', { name: 'Edit reminder: Shift handover' });
    await waitFor(() => expect(edit).toHaveFocus());
  });

  it('asks before deleting, then deletes, says so and moves focus to Pending', async () => {
    list = { pending: [reminder()], sent: [] };
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete reminder: Shift handover' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this reminder?' });
    expect(within(confirm).getByText('Shift handover')).toBeInTheDocument();
    expect(deletes()).toEqual([]);

    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Reminder deleted')).toBeInTheDocument();
    expect(deletes()).toEqual([
      { method: 'DELETE', path: `/api/reminders/${ID}`, body: undefined },
    ]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Shift handover' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Pending' })).toHaveFocus());
  });

  it('keeps the reminder when Delete is cancelled, with focus back on its button', async () => {
    list = { pending: [reminder()], sent: [] };
    renderScreen();
    const button = await screen.findByRole('button', { name: 'Delete reminder: Shift handover' });
    fireEvent.click(button);
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this reminder?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deletes()).toEqual([]);
    expect(screen.getByRole('link', { name: 'Shift handover' })).toBeInTheDocument();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('refetches when the server says the reminders changed', async () => {
    renderScreen();
    await screen.findByText('No reminders. Use Remind me on a page or event.');
    await act(() => live.open());

    list = { pending: [reminder()], sent: [] };
    await act(async () => {
      live.send({ type: 'reminders-changed' });
    });
    expect(await screen.findByRole('link', { name: 'Shift handover' })).toBeInTheDocument();
  });

  it('is the screen at /reminders', async () => {
    // Through the route's own lazy(): under jsdom, a router never loads a lazy first match.
    const [route] = routes;
    expect(route?.path).toBe('reminders');
    const lazy = route?.lazy;
    if (typeof lazy !== 'function') throw new Error('The route should load its screen lazily.');
    expect(await lazy()).toEqual({ Component: RemindersScreen });
  });
});

describe('usePendingReminders', () => {
  it('gives Home the next 5 pending reminders', async () => {
    list = {
      pending: Array.from({ length: 7 }, (_, i) =>
        reminder({ id: `00000000-0000-4000-8000-00000000000${i}`, note: `Note ${i}` }),
      ),
      sent: [],
    };
    const client = newClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePendingReminders(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(5));
    expect(result.current.data?.[0]).toEqual({
      id: '00000000-0000-4000-8000-000000000000',
      type: 'page',
      title: 'Shift handover',
      dueAt: '2026-10-27T21:30:00.000Z',
      note: 'Note 0',
      href: `/p/${PAGE_ID}`,
    });
  });
});
