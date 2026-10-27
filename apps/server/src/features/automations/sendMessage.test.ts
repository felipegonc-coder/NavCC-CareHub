import { randomUUID } from 'node:crypto';
import type { Action } from '@carehub/team-automations/automation';
import { describe, expect, it } from 'vitest';
import type { SendNoticeInput } from '../notices';
import type { Person } from './access';
import type { Automation, Run } from './domain/types';
import { AccessLost, type StepContext } from './running';
import { createSendMessage, noticeWords, recipientsAmong } from './sendMessage';

type SendMessageAction = Extract<Action, { kind: 'sendMessage' }>;

const workspaceId = randomUUID();
const avery: Person = { userId: randomUUID(), name: 'Avery Lin', roleId: 'admin', isAdmin: true };
const riley: Person = { userId: randomUUID(), name: 'Riley Chen', roleId: 'agent', isAdmin: false };
const sam: Person = { userId: randomUUID(), name: 'Sam Ortiz', roleId: 'agent', isAdmin: false };
// Tuesday, Oct 27, 2026, 9:00 AM in Denver.
const nine = new Date('2026-10-27T15:00:00.000Z');

const automation: Automation = {
  id: randomUUID(),
  workspaceId,
  name: 'Weekday stand-up nudge',
  ownerUserId: avery.userId,
  enabled: true,
  trigger: {
    kind: 'schedule',
    schedule: { kind: 'weekdays', time: '09:00', timeZone: 'America/Denver', endDate: null },
  },
  conditions: null,
  variables: [],
  actions: [],
  nextRunAt: null,
  pausedReason: null,
  lastRun: null,
  createdAt: nine,
  updatedAt: nine,
};

const run: Run = {
  id: randomUUID(),
  automationId: automation.id,
  workspaceId,
  kind: 'scheduled',
  key: `scheduled:${nine.toISOString()}`,
  plannedFor: nine,
  ranAt: nine,
  finishedAt: null,
  result: null,
  source: null,
  steps: [],
  recipients: 0,
  error: null,
  startedBy: null,
  createdAt: nine,
};

function message(overrides: Partial<SendMessageAction> = {}): SendMessageAction {
  return {
    kind: 'sendMessage',
    recipients: [{ kind: 'role', roleId: 'agent' }],
    text: 'Morning {first name}! Stand-up at 9:10 on {date}.',
    pageIds: [],
    ...overrides,
  };
}

function setUp(people: Person[] = [avery, riley, sam], open: Record<string, string[]> = {}) {
  const notices: SendNoticeInput[] = [];
  const send = createSendMessage({
    pagesOpenTo: async (userId, pageIds) =>
      new Set(pageIds.filter((pageId) => open[userId]?.includes(pageId))),
    sendNotice: async (input) => {
      notices.push(input);
    },
  });
  const ctx = (overrides: Partial<StepContext> = {}): StepContext => ({
    automation,
    run,
    step: 0,
    owner: avery,
    people,
    onlyTo: null,
    signal: new AbortController().signal,
    ...overrides,
  });
  return { notices, send, ctx };
}

describe('Send a message', () => {
  it('messages each member of the role, with their own first name and the date (AU-01, AU-02)', async () => {
    const { notices, send, ctx } = setUp();
    const done = await send(message(), ctx({ step: 1 }));

    expect(done).toEqual({ message: 'Messaged 2 people', recipients: 2 });
    expect(notices[0]).toEqual({
      workspaceId,
      userId: riley.userId,
      kind: 'automation',
      sender: 'Automation: Weekday stand-up nudge',
      title: 'Morning Riley! Stand-up at 9:10 on Tuesday, Oct 27.',
      groupKey: `automations:${run.id}:1`,
    });
    expect(notices).toMatchObject([
      { userId: riley.userId },
      { userId: sam.userId, title: 'Morning Sam! Stand-up at 9:10 on Tuesday, Oct 27.' },
    ]);
  });

  it('skips people who have left, and messages each person once', async () => {
    const { notices, send, ctx } = setUp();
    const recipients: SendMessageAction['recipients'] = [
      { kind: 'person', userId: randomUUID() },
      { kind: 'person', userId: riley.userId },
      { kind: 'role', roleId: 'agent' },
    ];
    const done = await send(message({ recipients }), ctx());

    expect(notices.map((notice) => notice.userId)).toEqual([riley.userId, sam.userId]);
    expect(done.recipients).toBe(2);
  });

  it('messages everyone in the workspace', async () => {
    const { notices, send, ctx } = setUp();
    await send(message({ recipients: [{ kind: 'everyone' }] }), ctx());

    expect(notices.map((notice) => notice.userId)).toEqual([
      avery.userId,
      riley.userId,
      sam.userId,
    ]);
  });

  it('sends a test only to the tester, marked Test (AU-04)', async () => {
    const { notices, send, ctx } = setUp();
    const done = await send(message(), ctx({ onlyTo: avery.userId }));

    expect(done).toEqual({ message: 'Sent only to you (Test)', recipients: 1 });
    expect(notices).toMatchObject([
      {
        userId: avery.userId,
        title: 'Test: Morning Avery! Stand-up at 9:10 on Tuesday, Oct 27.',
      },
    ]);
  });

  it('shows each recipient only the page cards they can open (AU-10)', async () => {
    const [handbook, rota, notes] = [randomUUID(), randomUUID(), randomUUID()];
    const { notices, send, ctx } = setUp([avery, riley, sam], {
      [avery.userId]: [handbook, rota, notes],
      [riley.userId]: [rota],
    });
    const action = message({
      recipients: [{ kind: 'everyone' }],
      text: '',
      pageIds: [handbook, rota, notes],
    });
    const done = await send(action, ctx());

    expect(notices).toMatchObject([
      {
        userId: avery.userId,
        title: 'Shared some pages with you',
        card: { type: 'page', pageId: handbook },
        buttons: [
          { label: 'Open page 2', href: `/p/${rota}` },
          { label: 'Open page 3', href: `/p/${notes}` },
        ],
      },
      {
        userId: riley.userId,
        title: 'Shared a page with you',
        card: { type: 'page', pageId: rota },
      },
    ]);
    expect(notices[1]).not.toHaveProperty('buttons');
    // Sam can open none of them, and there are no words to send.
    expect(done).toEqual({ message: 'Messaged 2 people', recipients: 2 });
  });

  it("pauses instead when its owner can't open a page card anymore (AU-20)", async () => {
    const [handbook, rota] = [randomUUID(), randomUUID()];
    const { notices, send, ctx } = setUp([avery, riley, sam], {
      [avery.userId]: [handbook],
      [riley.userId]: [handbook, rota],
    });
    const action = message({ pageIds: [handbook, rota] });
    const sent = send(action, ctx());
    await expect(sent).rejects.toThrow("Avery Lin can't open one of its pages anymore.");
    await expect(sent).rejects.toBeInstanceOf(AccessLost);
    expect(notices).toEqual([]);
  });

  it('messages up to 500 people and says how many more there were', async () => {
    const crowd = Array.from({ length: 503 }, (_, i) => ({
      userId: randomUUID(),
      name: `Agent ${i}`,
      roleId: 'agent',
      isAdmin: false,
    }));
    const { notices, send, ctx } = setUp(crowd);
    const done = await send(message(), ctx());

    expect(notices).toHaveLength(500);
    expect(done).toEqual({
      message: "Messaged 500 people, the most at once; 3 more weren't messaged",
      recipients: 500,
    });
  });

  it('says so when no one is left to message', async () => {
    const { notices, send, ctx } = setUp([avery]);
    const done = await send(message(), ctx());

    expect(notices).toEqual([]);
    expect(done).toEqual({ message: 'No one to message', recipients: 0 });
  });

  it('stops when the job is stopped', async () => {
    const { notices, send, ctx } = setUp();
    const stop = new AbortController();
    stop.abort();

    await expect(send(message(), ctx({ signal: stop.signal }))).rejects.toThrow();
    expect(notices).toEqual([]);
  });
});

describe('recipientsAmong', () => {
  it('keeps the members’ order', () => {
    const picked = recipientsAmong(
      [
        { kind: 'person', userId: sam.userId },
        { kind: 'person', userId: avery.userId },
      ],
      [avery, riley, sam],
    );
    expect(picked).toEqual([avery, sam]);
  });
});

describe('noticeWords', () => {
  it('makes the first line the title and the rest the text', () => {
    expect(noticeWords('Stand-up in 10 minutes\n\nBring your numbers.', 0, false)).toEqual({
      title: 'Stand-up in 10 minutes',
      text: 'Bring your numbers.',
    });
    expect(noticeWords('Stand-up in 10 minutes', 0, true)).toEqual({
      title: 'Test: Stand-up in 10 minutes',
    });
  });

  it('cuts a long first line and keeps the whole message as the text', () => {
    const long = 'Reminder '.repeat(30).trim();
    const words = noticeWords(long, 0, false);

    expect(words.title).toHaveLength(200);
    expect(words.title.endsWith('…')).toBe(true);
    expect(words.text).toBe(long);
  });
});
