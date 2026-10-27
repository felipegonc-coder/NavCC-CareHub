import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import {
  lookUpCards,
  registerNoticeCardResolver,
  type EventCardRef,
  type EventCardResult,
  type NoticeReader,
} from './cards';
import { eventCardKey, type NoticeRecord } from './domain/view';
import type { NoticeCard } from './types';

// Resolvers get the app's database as it is; lookUpCards never uses it itself.
const db = { name: 'test database' } as unknown as Db;
const avery: NoticeReader = {
  userId: '3f1c2d4e-0000-4000-8000-0000000a7e51',
  timeZone: 'America/Denver',
  use24h: false,
};

const standUp = { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02' } as const;
const retro = { type: 'event', eventId: 'evt_43' } as const;
const party = { type: 'event', eventId: 'evt_44' } as const;

let nextId = 0;
function recordWith(card: NoticeCard | null): NoticeRecord {
  nextId += 1;
  return {
    id: `notice-${nextId}`,
    workspaceId: '3f1c2d4e-0000-4000-8000-00000000c0de',
    userId: avery.userId,
    position: nextId,
    kind: 'reminder',
    sender: 'Calendar',
    actorUserId: null,
    icon: null,
    title: 'Starts in 15 minutes',
    text: null,
    card,
    buttons: [],
    groupKey: null,
    count: 1,
    createdAt: new Date('2026-11-02T08:45:00.000Z'),
    latestAt: new Date('2026-11-02T08:45:00.000Z'),
    readAt: null,
  };
}

function setup(results: Record<string, EventCardResult> | Error) {
  const calls: { db: Db; reader: NoticeReader; cards: EventCardRef[] }[] = [];
  registerNoticeCardResolver('event', async (database, reader, cards) => {
    calls.push({ db: database, reader, cards });
    if (results instanceof Error) throw results;
    return new Map(Object.entries(results));
  });
  const errors: unknown[] = [];
  const lookUp = (cards: (NoticeCard | null)[]) =>
    lookUpCards(db, avery, cards.map(recordWith), (error) => errors.push(error));
  return { calls, errors, lookUp };
}

afterEach(() => {
  registerNoticeCardResolver('event', null);
});

describe('lookUpCards', () => {
  it('asks Calendar once per page of the chat, for the reader, with each card once', async () => {
    const { calls, lookUp } = setup({});
    await lookUp([standUp, retro, { ...standUp }, { type: 'page', pageId: 'p-1' }, null]);
    expect(calls).toEqual([
      {
        db,
        reader: avery,
        cards: [
          { eventId: 'evt_42', occurrenceStart: '2026-11-02' },
          { eventId: 'evt_43', occurrenceStart: null },
        ],
      },
    ]);
  });

  it('shows open, locked and deleted events, and locks the ones left out', async () => {
    const open = { title: 'Weekly stand-up', when: 'Mon, Nov 2 · 9:00 AM', href: '/calendar' };
    const { lookUp } = setup({
      [eventCardKey(standUp)]: open,
      [eventCardKey(retro)]: { locked: true },
      [eventCardKey(party)]: { deleted: true },
    });
    const missing = { type: 'event', eventId: 'evt_45' } as const;
    const { events, pages } = await lookUp([standUp, retro, party, missing]);
    expect([...events]).toEqual([
      ['evt_42|2026-11-02', open],
      ['evt_43|', 'locked'],
      ['evt_44|', 'deleted'],
    ]);
    // Page cards stay locked until core's page cards are on main.
    expect(pages.size).toBe(0);
  });

  it('gives a card without a time a null when', async () => {
    const { lookUp } = setup({ [eventCardKey(retro)]: { title: 'Retro', href: '/calendar' } });
    const { events } = await lookUp([retro]);
    expect(events.get(eventCardKey(retro))).toEqual({
      title: 'Retro',
      when: null,
      href: '/calendar',
    });
  });

  it('locks a card with a blank title or a link off Care Hub, and logs it', async () => {
    const { errors, lookUp } = setup({
      [eventCardKey(standUp)]: { title: '  ', href: '/calendar' },
      [eventCardKey(retro)]: { title: 'Retro', href: 'https://example.test/retro' },
    });
    const { events } = await lookUp([standUp, retro]);
    expect(events.size).toBe(0);
    expect(errors).toHaveLength(2);
  });

  it('locks every event card on the page when Calendar fails, and logs it', async () => {
    const failure = new Error('calendar is down');
    const { errors, lookUp } = setup(failure);
    const { events } = await lookUp([standUp, retro]);
    expect(events.size).toBe(0);
    expect(errors).toEqual([failure]);
  });

  it("doesn't ask without event cards, or without a resolver", async () => {
    const { calls, lookUp } = setup({});
    await lookUp([{ type: 'page', pageId: 'p-1' }, null]);
    expect(calls).toEqual([]);

    registerNoticeCardResolver('event', null);
    const { events } = await lookUp([standUp]);
    expect(events.size).toBe(0);
  });
});
