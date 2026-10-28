import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewReminder, Reminder } from './api';
import type { RemindMeTarget } from './choices';
import { RemindMeDialog } from './RemindMeDialog';

const PAGE_ID = '5d1f0a52-8f1e-4c4b-9a52-0d6a3c1e7b10';
const EVENT_ID = '9b2c6e41-3d7a-4f0e-8c15-6a4e2f9d1c37';
// 10:30 AM today in Denver.
const STANDUP_START = '2026-10-27T16:30:00.000Z';

const page: RemindMeTarget = { type: 'page', pageId: PAGE_ID, title: 'Shift handover' };
const standup: RemindMeTarget = {
  type: 'event',
  eventId: EVENT_ID,
  occurrenceStart: '2026-10-27T10:30',
  title: 'Team standup',
  allDay: false,
  start: STANDUP_START,
};
const training: RemindMeTarget = {
  type: 'event',
  eventId: EVENT_ID,
  title: 'Safety training',
  allDay: true,
  start: '2026-10-30',
};

type Call = { method: string; path: string; body: unknown };
type Answer = { status: number; body?: unknown };

const realFetch = globalThis.fetch;
let calls: Call[];
let answer: ((call: Call) => Answer | Promise<Answer> | undefined) | undefined;

const me = (timeZone = 'America/Denver'): Answer => ({
  status: 200,
  body: { user: { timeZone, use24h: false } },
});

/** The reminder POST /api/reminders sends back. */
function created(input: NewReminder): Reminder {
  const minutesBefore = 'minutesBefore' in input ? input.minutesBefore : null;
  const dueAt =
    'at' in input ? input.at : new Date(Date.parse(STANDUP_START) - (minutesBefore ?? 0) * 60_000);
  return {
    id: 'c0a8f3e2-1b4d-4e6f-9a7c-2d5e8f1a3b60',
    target: input.target,
    title: 'Shift handover',
    href: `/p/${PAGE_ID}`,
    minutesBefore,
    dueAt: new Date(dueAt).toISOString(),
    note: input.note ?? '',
    status: 'pending',
    sentAt: null,
    createdAt: new Date().toISOString(),
  };
}

function serve(call: Call): Answer {
  if (call.path === '/api/auth/me') return me();
  if (call.method === 'POST' && call.path === '/api/reminders') {
    return { status: 201, body: { reminder: created(call.body as NewReminder) } };
  }
  return { status: 404 };
}

beforeEach(() => {
  // Tuesday, Oct 27, 2026, 9:00 AM in Denver. Only Date is faked; timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T15:00:00.000Z'));
  calls = [];
  answer = undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { method: init?.method ?? 'GET', path: String(input), body };
    calls.push(call);
    const { status, body: reply } = (await answer?.(call)) ?? serve(call);
    if (reply === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(reply), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

/** Remind me as a feature opens it: shown until it closes. */
function Harness({ target }: { target: RemindMeTarget }) {
  const [open, setOpen] = useState(true);
  return open ? <RemindMeDialog target={target} onClose={() => setOpen(false)} /> : <p>Closed</p>;
}

function renderDialog(target: RemindMeTarget) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <ToastProvider>
      <QueryClientProvider client={client}>
        <Harness target={target} />
      </QueryClientProvider>
    </ToastProvider>,
  );
}

async function choices() {
  const menu = await screen.findByRole('menu', { name: 'Remind me' });
  return within(menu).getAllByRole('menuitem');
}

const names = (items: HTMLElement[]) => items.map((item) => item.textContent);
const posts = () => calls.filter((call) => call.method === 'POST');

describe('RemindMeDialog', () => {
  it('offers the page presets in a menu, and sets the one picked with the note', async () => {
    renderDialog(page);
    const dialog = await screen.findByRole('dialog', { name: 'Remind me' });
    expect(within(dialog).getByText('Shift handover')).toBeInTheDocument();
    const items = await choices();
    expect(names(items)).toEqual([
      'In 1 hour',
      'Later today at 5:00 PM',
      'Tomorrow at 9:00 AM',
      'Next Monday at 9:00 AM',
      'Custom date and time…',
    ]);
    expect(items[0]).toHaveFocus();

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: ' Bring the binder ' },
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tomorrow at 9:00 AM' }));

    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(posts().map((call) => call.body)).toEqual([
      {
        target: { type: 'page', pageId: PAGE_ID },
        at: '2026-10-28T15:00:00.000Z',
        note: 'Bring the binder',
      },
    ]);
    expect(await screen.findByText('Reminder set')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow at 9:00 AM')).toBeInTheDocument();
  });

  it('moves through the choices with the arrow keys, Home and End', async () => {
    renderDialog(page);
    const items = await choices();
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1]!, { key: 'ArrowUp' });
    fireEvent.keyDown(items[0]!, { key: 'ArrowUp' });
    expect(items[4]).toHaveFocus();
    fireEvent.keyDown(items[4]!, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0]!, { key: 'End' });
    expect(items[4]).toHaveFocus();
    // One Tab stop: only the focused choice is in the tab order.
    expect(items.map((item) => item.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '-1',
      '-1',
      '0',
    ]);
  });

  it('offers the times before a timed event that are still to come, for its occurrence', async () => {
    renderDialog(standup);
    expect(names(await choices())).toEqual([
      'At the start',
      '5 minutes before',
      '10 minutes before',
      '30 minutes before',
      '1 hour before',
      'Custom…',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: '10 minutes before' }));

    expect(await screen.findByText('Today at 10:20 AM')).toBeInTheDocument();
    expect(posts().map((call) => call.body)).toEqual([
      {
        target: { type: 'event', eventId: EVENT_ID, occurrenceStart: '2026-10-27T10:30' },
        minutesBefore: 10,
      },
    ]);
  });

  it('offers on the day and the day before for an all-day event, or days before and a time', async () => {
    renderDialog(training);
    expect(names(await choices())).toEqual([
      'On the day at 9:00 AM',
      'The day before at 9:00 AM',
      'Custom…',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Custom…' }));
    const days = screen.getByRole('spinbutton', { name: 'Days before' });
    expect(days).toHaveFocus();
    fireEvent.change(days, { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    await screen.findByText('Closed');
    expect(posts().map((call) => call.body)).toEqual([
      { target: { type: 'event', eventId: EVENT_ID }, minutesBefore: 2370 },
    ]);
  });

  it('sets a custom date and time for a page, and Back returns to the menu', async () => {
    renderDialog(page);
    fireEvent.click((await choices())[4]!);
    // It starts at the next full hour.
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-27');
    expect(screen.getByLabelText('Time')).toHaveValue('10:00');
    expect(screen.getByLabelText('Date')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    const custom = screen.getByRole('menuitem', { name: 'Custom date and time…' });
    expect(custom).toHaveFocus();

    fireEvent.click(custom);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-28' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    await screen.findByText('Closed');
    expect(posts().map((call) => call.body)).toEqual([
      { target: { type: 'page', pageId: PAGE_ID }, at: '2026-10-28T20:15:00.000Z' },
    ]);
  });

  it('checks a custom time before an event before sending it', async () => {
    renderDialog(standup);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Custom…' }));
    const amount = screen.getByRole('spinbutton', { name: 'How long before' });
    const unit = screen.getByRole('combobox', { name: 'Unit' });
    const set = () => fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    fireEvent.change(amount, { target: { value: '29' } });
    fireEvent.change(unit, { target: { value: 'days' } });
    set();
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a time up to 28 days before.');

    fireEvent.change(amount, { target: { value: '2' } });
    fireEvent.change(unit, { target: { value: 'hours' } });
    set();
    expect(screen.getByRole('alert')).toHaveTextContent('That time has already passed.');
    expect(posts()).toEqual([]);

    fireEvent.change(amount, { target: { value: '45' } });
    fireEvent.change(unit, { target: { value: 'minutes' } });
    set();
    await screen.findByText('Closed');
    expect(
      posts().map((call) => (call.body as NewReminder & { minutesBefore: number }).minutesBefore),
    ).toEqual([45]);
  });

  it('shows the server’s reason when it refuses, and stays open', async () => {
    answer = (call) =>
      call.method === 'POST'
        ? {
            status: 403,
            body: { error: { code: 'forbidden', message: "You don't have access to this." } },
          }
        : undefined;
    renderDialog(page);
    fireEvent.click((await choices())[0]!);

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this.");
    expect(screen.getByRole('dialog', { name: 'Remind me' })).toBeInTheDocument();
  });

  it('waits for the person’s time zone before offering preset times (HR-13)', async () => {
    let answerMe: (answer: Answer) => void = () => {};
    const pending = new Promise<Answer>((resolve) => {
      answerMe = resolve;
    });
    answer = (call) => (call.path === '/api/auth/me' ? pending : undefined);
    renderDialog(page);
    await screen.findByRole('dialog', { name: 'Remind me' });
    expect(screen.queryByRole('menu')).toBeNull();

    answerMe(me('America/New_York'));
    // 11:00 AM in New York: tomorrow at 9:00 AM is 13:00 UTC.
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tomorrow at 9:00 AM' }));
    await screen.findByText('Closed');
    expect(posts().map((call) => (call.body as { at: string }).at)).toEqual([
      '2026-10-28T13:00:00.000Z',
    ]);
  });
});
