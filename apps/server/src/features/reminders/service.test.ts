import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendNotice } from '../notices';
import { bindMemoryNotices } from '../notices/testing';
import {
  createEventReminder,
  createReminder,
  deleteEventReminders,
  deleteReminder,
  fireReminder,
  listReminders,
  registerEventLookup,
  syncEventReminders,
  updateReminder,
  type EventReminderInput,
} from './service';
import { bindMemoryReminders, memoryDb } from './testing';
import type { EventStart, Viewer } from './types';

const W1 = '7d1e2f30-4a5b-4c6d-9e8f-0a1b2c3d4e5f';
const AVERY = 'a1b2c3d4-0000-4000-8000-000000000001';
const SAM = 'a1b2c3d4-0000-4000-8000-000000000002';
const viewer: Viewer = {
  userId: AVERY,
  workspaceId: W1,
  timeZone: 'America/Denver',
  use24h: false,
};
const PAGE = { type: 'page', pageId: '5e0c1d2a-3b4c-4d5e-8f60-718293a4b5c6' } as const;
const at = (iso: string): EventStart => ({ start: new Date(iso) });
const minutes = (n: number) => n * 60_000;
const event = (overrides: Partial<EventReminderInput> = {}): EventReminderInput => ({
  workspaceId: W1,
  userId: AVERY,
  eventId: 'evt_1',
  start: at('2026-10-27T17:00:00Z'),
  minutesBefore: 10,
  timeZone: 'America/Denver',
  use24h: false,
  ...overrides,
});

let clock: Date;
let memory: ReturnType<typeof bindMemoryReminders>;
const tick = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const stored = (id: string | undefined) => memory.store.get(memoryDb, id ?? '');

beforeEach(() => {
  clock = new Date('2026-10-27T14:00:00Z'); // 8:00 AM in Denver
  memory = bindMemoryReminders({ now: () => clock });
});
afterEach(() => memory.unbind());

describe('sending', () => {
  it('arrives at its time with the card and buttons, and is marked sent (HR-07)', async () => {
    const created = await createEventReminder(memoryDb, event());
    expect(memory.jobs).toMatchObject([
      { key: `reminders.fire:${created?.reminderId}:${Date.parse('2026-10-27T16:50:00Z')}` },
    ]);
    expect(memory.jobs[0]).toMatchObject({
      runAt: new Date('2026-10-27T16:50:00Z'),
      ownerUserId: AVERY,
    });
    expect(await memory.runDueJobs()).toBe(0);
    tick(minutes(170));
    expect(await memory.runDueJobs()).toBe(1);
    expect(memory.notices).toMatchObject([
      {
        userId: AVERY,
        kind: 'reminder',
        title: 'Reminder',
        card: { type: 'event', eventId: 'evt_1' },
      },
    ]);
    expect(memory.notices[0]?.text).toBeUndefined();
    expect(await stored(created?.reminderId)).toMatchObject({ status: 'sent', sentAt: clock });
  });

  it('sends a notice the notices feature accepts', async () => {
    memory.unbind();
    const notices = bindMemoryNotices();
    memory = bindMemoryReminders({ now: () => clock, sendNotice });
    try {
      await createEventReminder(memoryDb, event({ occurrenceStart: '2026-10-27T17:00:00Z' }));
      tick(minutes(170));
      expect(await memory.runDueJobs()).toBe(1);
      expect(notices.store.records).toMatchObject([
        { userId: AVERY, kind: 'reminder', sender: 'Reminders', icon: '⏰', title: 'Reminder' },
      ]);
    } finally {
      notices.unbind();
    }
  });

  it('is still sent after a restart, hours late, saying when it was due (HR-11)', async () => {
    await createEventReminder(memoryDb, event({ start: at('2026-10-27T15:10:00Z') }));
    tick(minutes(60 * 6));
    const [job] = memory.jobs;
    expect(await fireReminder(memoryDb, job!.payload)).toEqual({ sent: true });
    expect(memory.notices[0]?.text).toBe('Late: was due at 9:00 AM');
    expect(await fireReminder(memoryDb, job!.payload)).toEqual({ sent: false });
    expect(memory.notices).toHaveLength(1);
  });
});

describe('Calendar’s event reminders (HR-08)', () => {
  it('moves when the event moves, and the old job finds nothing to send', async () => {
    const created = await createEventReminder(memoryDb, event());
    const moved = { eventId: 'evt_1', start: at('2026-10-27T18:00:00Z') };
    expect(await syncEventReminders(memoryDb, moved)).toBe(1);
    expect(await syncEventReminders(memoryDb, moved)).toBe(0);
    expect((await stored(created?.reminderId))?.dueAt).toEqual(new Date('2026-10-27T17:50:00Z'));
    tick(minutes(170));
    expect(await memory.runDueJobs()).toBe(0);
    tick(minutes(60));
    expect(await memory.runDueJobs()).toBe(1);
  });

  it('is sent within a minute when a move puts it in the past, saying when it was due', async () => {
    await createEventReminder(memoryDb, event({ minutesBefore: 30 }));
    await syncEventReminders(memoryDb, { eventId: 'evt_1', start: at('2026-10-27T14:20:00Z') });
    tick(minutes(1));
    expect(await memory.runDueJobs()).toBe(1);
    expect(memory.notices[0]?.text).toBe('Late: was due at 7:50 AM');
  });

  it('is gone when the event is deleted', async () => {
    const created = await createEventReminder(memoryDb, event());
    await createEventReminder(memoryDb, event({ userId: SAM }));
    expect(await deleteEventReminders(memoryDb, { eventId: 'evt_1' })).toBe(2);
    expect(await stored(created?.reminderId)).toMatchObject({ status: 'deleted' });
    tick(minutes(170));
    expect(await memory.runDueJobs()).toBe(0);
  });

  it('keeps the occurrences of a repeating event apart', async () => {
    const first = '2026-10-28T15:00:00Z';
    const second = '2026-10-29T15:00:00Z';
    const a = await createEventReminder(
      memoryDb,
      event({ occurrenceStart: first, start: at(first) }),
    );
    const b = await createEventReminder(
      memoryDb,
      event({ occurrenceStart: second, start: at(second) }),
    );
    const moveSecond = {
      eventId: 'evt_1',
      occurrenceStart: second,
      start: at('2026-10-29T16:00:00Z'),
    };
    expect(await syncEventReminders(memoryDb, moveSecond)).toBe(1);
    expect(await syncEventReminders(memoryDb, { eventId: 'evt_1', start: at(first) })).toBe(0);
    expect(await deleteEventReminders(memoryDb, { eventId: 'evt_1', occurrenceStart: first })).toBe(
      1,
    );
    expect(await stored(a?.reminderId)).toMatchObject({ status: 'deleted' });
    expect(await stored(b?.reminderId)).toMatchObject({
      status: 'pending',
      target: { type: 'event', eventId: 'evt_1', occurrenceStart: second },
      dueAt: new Date('2026-10-29T15:50:00Z'),
    });
  });

  it('puts all-day reminders at 9:00 AM in the person’s zone', async () => {
    const allDay = event({
      start: { allDay: '2026-10-29' },
      minutesBefore: 900,
      timeZone: 'America/New_York',
    });
    const created = await createEventReminder(memoryDb, allDay);
    expect((await stored(created?.reminderId))?.dueAt).toEqual(new Date('2026-10-28T13:00:00Z'));
  });

  it('skips a time that has passed and a person at the limit', async () => {
    expect(
      await createEventReminder(memoryDb, event({ start: at('2026-10-27T14:05:00Z') })),
    ).toBeNull();
    for (let i = 0; i < 500; i += 1)
      await createEventReminder(memoryDb, event({ eventId: `evt_${i}` }));
    expect(await createEventReminder(memoryDb, event())).toBeNull();
    expect(memory.store.reminders).toHaveLength(500);
  });

  it('refuses input that breaks the rules', async () => {
    await expect(createEventReminder(memoryDb, event({ eventId: 'evt 1' }))).rejects.toThrow();
    await expect(createEventReminder(memoryDb, event({ minutesBefore: 1.5 }))).rejects.toThrow();
  });
});

const inOneHour = () => new Date(clock.getTime() + minutes(60));

describe('Remind me on a page (HR-07)', () => {
  it('arrives at its time with the note, and the list shows it pending, then sent', async () => {
    const note = 'Call Bluebird Bakery about the order';
    const reminder = await createReminder(memoryDb, viewer, {
      target: PAGE,
      at: inOneHour(),
      note,
    });
    expect(reminder).toMatchObject({ status: 'pending', minutesBefore: null, note });
    expect((await listReminders(memoryDb, viewer)).pending.map((r) => r.id)).toEqual([reminder.id]);
    tick(minutes(60));
    expect(await memory.runDueJobs()).toBe(1);
    expect(memory.notices).toMatchObject([{ userId: AVERY, text: note, card: PAGE }]);
    const list = await listReminders(memoryDb, viewer);
    expect(list.pending).toEqual([]);
    expect(list.sent).toMatchObject([{ id: reminder.id, status: 'sent' }]);
  });

  it('refuses a time that has passed, a page they can’t open, and a 501st', async () => {
    await expect(
      createReminder(memoryDb, viewer, { target: PAGE, at: clock }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'That time has already passed.',
    });
    for (let i = 0; i < 500; i += 1) {
      await createReminder(memoryDb, viewer, { target: PAGE, at: inOneHour() });
    }
    await expect(
      createReminder(memoryDb, viewer, { target: PAGE, at: inOneHour() }),
    ).rejects.toMatchObject({
      statusCode: 413,
      message: 'You can have up to 500 pending reminders. Delete some first.',
    });
    memory.unbind();
    memory = bindMemoryReminders({ now: () => clock, canOpenPage: async () => false });
    await expect(
      createReminder(memoryDb, viewer, { target: PAGE, at: inOneHour() }),
    ).rejects.toMatchObject({ statusCode: 403, message: "You don't have access to this." });
  });

  it('changes the time and note while pending, in the person’s zone now', async () => {
    const reminder = await createReminder(memoryDb, viewer, { target: PAGE, at: inOneHour() });
    const later = new Date(clock.getTime() + minutes(120));
    const inNewYork = { ...viewer, timeZone: 'America/New_York' };
    const input = { at: later, note: 'Bring the Northwind Tiles samples' };
    const changed = await updateReminder(memoryDb, inNewYork, reminder.id, input);
    expect(changed).toMatchObject({ note: input.note, timeZone: 'America/New_York' });
    expect(changed.dueAt).toEqual(later);
    tick(minutes(60));
    expect(await memory.runDueJobs()).toBe(0);
    tick(minutes(60));
    expect(await memory.runDueJobs()).toBe(1);
    await expect(
      updateReminder(memoryDb, viewer, reminder.id, { note: 'Again' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'This reminder was already sent. Set a new one instead.',
    });
  });

  it('takes a time, not minutes before, and a time still to come', async () => {
    const { id } = await createReminder(memoryDb, viewer, { target: PAGE, at: inOneHour() });
    await expect(updateReminder(memoryDb, viewer, id, { minutesBefore: 10 })).rejects.toMatchObject(
      {
        statusCode: 400,
      },
    );
    await expect(updateReminder(memoryDb, viewer, id, { at: clock })).rejects.toMatchObject({
      message: 'That time has already passed.',
    });
  });

  it('is deleted: gone from the list and never sent', async () => {
    const { id } = await createReminder(memoryDb, viewer, { target: PAGE, at: inOneHour() });
    await deleteReminder(memoryDb, viewer, id);
    expect(await listReminders(memoryDb, viewer)).toEqual({ pending: [], sent: [] });
    tick(minutes(60));
    expect(await memory.runDueJobs()).toBe(0);
    await expect(deleteReminder(memoryDb, viewer, id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('belongs to its owner only (HR-12)', async () => {
    const { id } = await createReminder(memoryDb, viewer, { target: PAGE, at: inOneHour() });
    const sam = { ...viewer, userId: SAM };
    const refused = { statusCode: 403, code: 'forbidden' };
    await expect(updateReminder(memoryDb, sam, id, { note: 'Mine' })).rejects.toMatchObject(
      refused,
    );
    await expect(deleteReminder(memoryDb, sam, id)).rejects.toMatchObject(refused);
    expect(await listReminders(memoryDb, sam)).toEqual({ pending: [], sent: [] });
    await expect(
      updateReminder(memoryDb, viewer, randomUUID(), { note: 'x' }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('Remind me on an event', () => {
  afterEach(() => registerEventLookup(null));
  const target = { type: 'event', eventId: 'evt_1', occurrenceStart: '2026-10-27T11:00' } as const;

  it('goes by the start Calendar looks up, for people who can open the event', async () => {
    const asked: unknown[] = [];
    registerEventLookup(async (_db, userId, found) => {
      asked.push({ userId, eventId: found.eventId, occurrenceStart: found.occurrenceStart });
      return userId === AVERY ? at('2026-10-27T17:00:00Z') : null;
    });
    const reminder = await createReminder(memoryDb, viewer, { target, minutesBefore: 10 });
    expect(reminder.dueAt).toEqual(new Date('2026-10-27T16:50:00Z'));
    expect(asked).toEqual([
      { userId: AVERY, eventId: 'evt_1', occurrenceStart: '2026-10-27T11:00' },
    ]);
    const changed = await updateReminder(memoryDb, viewer, reminder.id, { minutesBefore: 60 });
    expect([changed.minutesBefore, changed.dueAt]).toEqual([60, new Date('2026-10-27T16:00:00Z')]);
    const sam = { ...viewer, userId: SAM };
    await expect(
      createReminder(memoryDb, sam, { target, minutesBefore: 10 }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      createReminder(memoryDb, viewer, { target, minutesBefore: -5 }),
    ).rejects.toMatchObject({
      message: 'Pick a time before the event starts.',
    });
  });

  it('is refused until Calendar registers its lookup', async () => {
    await expect(
      createReminder(memoryDb, viewer, { target, minutesBefore: 10 }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
