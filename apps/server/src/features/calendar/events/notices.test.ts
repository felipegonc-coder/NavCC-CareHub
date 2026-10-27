import { describe, expect, it } from 'vitest';
import { planDelete, planEdit } from './edit';
import type { StoredEvent } from './items';
import { NOTICE_TITLES, cancelNotices, editNotices, invites, replyNotice } from './notices';

const ada = '00000000-0000-4000-8000-00000000000a';
const ben = '00000000-0000-4000-8000-00000000000b';
const cy = '00000000-0000-4000-8000-00000000000c';
const split = '00000000-0000-4000-8000-0000000000e2';
const organizer = {
  id: ada,
  workspaceId: '00000000-0000-4000-8000-0000000000f1',
  name: 'Ada Example',
};

const ben0 = { userId: ben, reply: null, note: null, occurrenceReplies: {} };

/** Ada's huddle on Tue, Oct 27, 2026, 10:00 to 11:00 in Denver, with Ben invited. */
const huddle: StoredEvent = {
  id: '00000000-0000-4000-8000-0000000000e1',
  organizerId: ada,
  allDay: false,
  timeZone: 'America/Denver',
  start: '2026-10-27T10:00',
  end: '2026-10-27T11:00',
  rule: null,
  exceptions: [],
  overrides: {},
  title: 'Team huddle',
  location: '',
  description: '',
  videoUrl: null,
  notesPageId: null,
  people: [ben0],
  createdAt: new Date('2026-10-26T12:00:00.000Z'),
  updatedAt: new Date('2026-10-26T12:00:00.000Z'),
};

/** The same, every Tuesday from Oct 20. */
const weekly: StoredEvent = {
  ...huddle,
  start: '2026-10-20T10:00',
  end: '2026-10-20T11:00',
  rule: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] },
};

const card = (occurrenceStart?: string, eventId = huddle.id) => ({
  type: 'event',
  eventId,
  ...(occurrenceStart ? { occurrenceStart } : {}),
});

const sent = (notices: { userId: string; title: string }[]) =>
  notices.map(({ userId, title }) => [userId, title]);

describe('Calendar notices', () => {
  it('invites people from the organizer, with the event on the card', () => {
    expect(invites(organizer, huddle.id, [ben])).toEqual([
      {
        workspaceId: organizer.workspaceId,
        userId: ben,
        kind: 'alert',
        sender: 'Ada Example',
        actorUserId: ada,
        icon: '📅',
        title: 'Invited you to a meeting',
        card: card(),
      },
    ]);
  });

  it('tells people who stay that the time changed, and invites the ones added', () => {
    const edit = { start: '2026-10-27T16:30:00.000Z', end: '2026-10-27T17:30:00.000Z' };
    const plan = planEdit(huddle, { ...edit, people: [ben, cy] });
    const notices = editNotices(organizer, huddle, plan, { eventId: huddle.id, splitId: null }, {});
    expect(sent(notices)).toEqual([
      [ben, NOTICE_TITLES.changed],
      [cy, NOTICE_TITLES.invited],
    ]);
    expect(notices[0]).toMatchObject({ card: card(), groupKey: `calendar:${huddle.id}:changed:` });

    // A new title, or the same times sent again, says nothing.
    const ids = { eventId: huddle.id, splitId: null };
    const same = { start: '2026-10-27T16:00:00.000Z', end: '2026-10-27T17:00:00.000Z' };
    for (const unchanged of [{ title: 'Huddle' }, same]) {
      expect(editNotices(organizer, huddle, planEdit(huddle, unchanged), ids, {})).toEqual([]);
    }
  });

  it('points at the occurrence for This event, and the new series for This and following', () => {
    const ids = { eventId: weekly.id, splitId: null };
    const one = { scope: 'one', occurrence: '2026-10-27T10:00' } as const;
    const moved = planEdit(weekly, {
      ...one,
      start: '2026-10-27T17:00:00.000Z',
      end: '2026-10-27T18:00:00.000Z',
    });
    const [change] = editNotices(organizer, weekly, moved, ids, one);
    expect(change).toMatchObject({ userId: ben, card: card('2026-10-27T10:00', weekly.id) });
    const renamed = planEdit(weekly, { ...one, title: 'Huddle' });
    expect(editNotices(organizer, weekly, renamed, ids, one)).toEqual([]);

    const following = { scope: 'following', occurrence: '2026-11-03T10:00' } as const;
    const later = planEdit(weekly, {
      ...following,
      start: '2026-11-03T18:00:00.000Z',
      end: '2026-11-03T19:00:00.000Z',
    });
    const splitIds = { eventId: weekly.id, splitId: split };
    const notices = editNotices(organizer, weekly, later, splitIds, following);
    expect(notices).toMatchObject([
      { userId: ben, title: NOTICE_TITLES.changed, card: card(undefined, split) },
    ]);
    const retitled = planEdit(weekly, { ...following, title: 'Huddle' });
    expect(editNotices(organizer, weekly, retitled, splitIds, following)).toEqual([]);
  });

  it('tells the people on a meeting what was cancelled', () => {
    const all = planDelete(huddle, {});
    expect(cancelNotices(organizer, huddle, all, {})).toMatchObject([
      { userId: ben, title: NOTICE_TITLES.cancelled, card: card() },
    ]);
    const query = { scope: 'one', occurrence: '2026-10-27T10:00' } as const;
    expect(cancelNotices(organizer, weekly, planDelete(weekly, query), query)).toMatchObject([
      { userId: ben, title: NOTICE_TITLES.cancelled, card: card(query.occurrence, weekly.id) },
    ]);
    const rest = { scope: 'following', occurrence: '2026-11-03T10:00' } as const;
    expect(cancelNotices(organizer, weekly, planDelete(weekly, rest), rest)).toMatchObject([
      {
        title: NOTICE_TITLES.cancelledLater,
        text: 'From Tue, Nov 3 on.',
        card: card(undefined, weekly.id),
      },
    ]);
    expect(cancelNotices(organizer, { ...huddle, people: [] }, null, {})).toEqual([]);
  });

  it('sends each reply to the organizer, from the person who replied', () => {
    const from = { ...organizer, id: ben, name: 'Ben Sample' };
    const body = { reply: 'maybe', note: 'Running late', occurrence: '2026-10-27T10:00' } as const;
    expect(replyNotice(from, weekly, body)).toMatchObject({
      userId: ada,
      sender: 'Ben Sample',
      actorUserId: ben,
      title: 'Answered Maybe to your meeting',
      text: 'Running late',
      card: card(body.occurrence, weekly.id),
      groupKey: `calendar:${weekly.id}:reply:${ben}:2026-10-27T10:00`,
    });
    const plain = replyNotice(from, huddle, { reply: 'not-going', note: '' });
    expect(plain).toMatchObject({ title: 'Answered Not going to your meeting', card: card() });
    expect(plain).not.toHaveProperty('text');
  });
});
