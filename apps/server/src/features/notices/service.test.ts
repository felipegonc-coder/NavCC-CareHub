import { describe, expect, it } from 'vitest';
import type { NoticeFilter } from './domain/filters';
import { NoticeInputError } from './domain/validate';
import { isNoticeOwner } from './domain/view';
import {
  bindNoticesRuntime,
  deliverNotice,
  sendNotice,
  type LiveNudge,
  type NoticeScope,
  type NoticesRuntime,
} from './service';
import { bindMemoryNotices, createMemoryNoticeStore } from './testing';
import type { NoticeCreatedEvent, SendNoticeInput } from './types';

// Care Team Demo (and a second workspace); Avery Lin, Sam Ortiz and Riley Chen.
const workspaceId = '3f1c2d4e-0000-4000-8000-00000000c0de';
const otherWorkspaceId = '3f1c2d4e-0000-4000-8000-00000000c0df';
const avery = '3f1c2d4e-0000-4000-8000-0000000a7e51';
const sam = '3f1c2d4e-0000-4000-8000-00000000005a';
const riley = '3f1c2d4e-0000-4000-8000-0000000c4e11';
const coachingPlan = '3f1c2d4e-0000-4000-8000-0000000c0a01';

const averysChat: NoticeScope = { workspaceId, userId: avery };
const MINUTE = 60 * 1000;

function comment(overrides: Partial<SendNoticeInput> = {}): SendNoticeInput {
  return {
    workspaceId,
    userId: avery,
    kind: 'comment',
    sender: 'Sam Ortiz',
    actorUserId: sam,
    title: 'Commented on a page',
    text: 'Looks good to me.',
    card: { type: 'page', pageId: coachingPlan },
    groupKey: `comments:${coachingPlan}`,
    ...overrides,
  };
}

/** A runtime over a memory store, with a clock the test moves and a log of what happened. */
function setup(
  options: { emit?: NoticesRuntime['emit']; isMember?: NoticesRuntime['isMember'] } = {},
) {
  const store = createMemoryNoticeStore();
  const log: string[] = [];
  const emitted: [string, NoticeCreatedEvent][] = [];
  const published: [readonly string[], LiveNudge][] = [];
  const errors: unknown[] = [];
  let clock = new Date('2026-10-27T09:00:00.000Z');
  const runtime: NoticesRuntime = {
    store: {
      ...store,
      async save(notice, now) {
        const result = await store.save(notice, now);
        log.push('save');
        return result;
      },
    },
    emit:
      options.emit ??
      ((name, payload) => {
        log.push('emit');
        emitted.push([name, payload]);
      }),
    publish: (userIds, event) => {
      log.push('publish');
      published.push([userIds, event]);
    },
    now: () => clock,
    onError: (error) => errors.push(error),
  };
  if (options.isMember) runtime.isMember = options.isMember;
  return {
    store,
    runtime,
    log,
    emitted,
    published,
    errors,
    send: (input: SendNoticeInput) => deliverNotice(runtime, input),
    wait: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe('deliverNotice', () => {
  it('saves the notice, then emits notices.notice.created and nudges its owner', async () => {
    const { store, log, emitted, published, send } = setup();
    const result = await send(comment());
    expect(result).toEqual({ noticeId: store.records[0]?.id, grouped: false });
    expect(log).toEqual(['save', 'emit', 'publish']);
    expect(emitted).toEqual([
      [
        'notices.notice.created',
        { workspaceId, userId: avery, noticeId: result.noticeId, kind: 'comment', grouped: false },
      ],
    ]);
    expect(published).toEqual([[[avery], { type: 'notices-changed' }]]);
  });

  it('saves nothing and tells no one when the input breaks the rules', async () => {
    const { store, log, send } = setup();
    await expect(send(comment({ title: ' ' }))).rejects.toBeInstanceOf(NoticeInputError);
    expect(store.records).toHaveLength(0);
    expect(log).toEqual([]);
  });

  it('still sends when a follow-up after the commit fails', async () => {
    const failure = new Error('A listener failed');
    const { store, log, errors, send } = setup({
      emit: () => {
        throw failure;
      },
    });
    await expect(send(comment())).resolves.toMatchObject({ grouped: false });
    expect(store.records).toHaveLength(1);
    expect(errors).toEqual([failure]);
    expect(log).toEqual(['save', 'publish']);
  });
});

describe('grouping', () => {
  it('updates the last notice with the same key within 5 minutes in place', async () => {
    const { store, emitted, send, wait } = setup();
    const first = await send(comment());
    wait(MINUTE);
    const other = await send(comment({ groupKey: 'reminders:stand-up', title: 'Stand-up soon' }));
    await store.markRead(averysChat, { noticeIds: [first.noticeId] }, new Date());
    wait(3 * MINUTE);
    const second = await send(comment({ text: 'One more thing: the dates.' }));

    expect(second).toEqual({ noticeId: first.noticeId, grouped: true });
    expect(emitted.at(-1)?.[1]).toMatchObject({ noticeId: first.noticeId, grouped: true });
    const chat = await store.list(averysChat, { limit: 10 });
    expect(chat.map((notice) => notice.id)).toEqual([first.noticeId, other.noticeId]);
    expect(chat[0]).toMatchObject({
      text: 'One more thing: the dates.',
      count: 2,
      readAt: null,
    });
    expect(chat[0]?.createdAt.toISOString()).toBe('2026-10-27T09:00:00.000Z');
    expect(chat[0]?.latestAt.toISOString()).toBe('2026-10-27T09:04:00.000Z');
  });

  it('keeps grouping a steady stream: the window counts from the last arrival', async () => {
    const { store, send, wait } = setup();
    for (let step = 0; step < 4; step += 1) {
      await send(comment());
      wait(4 * MINUTE);
    }
    expect(store.records).toHaveLength(1);
    expect(store.records[0]?.count).toBe(4);
  });

  const apart: [name: string, next: SendNoticeInput][] = [
    ['for another person', comment({ userId: riley })],
    ['in another workspace', comment({ workspaceId: otherWorkspaceId })],
    ['with another key', comment({ groupKey: 'comments:qa-form' })],
    ['without a key', comment({ groupKey: undefined })],
    ['of another kind', comment({ kind: 'suggestion' })],
    // A comment that mentions the person is never folded into their comment notices (CM-08).
    ['for a mention', comment({ kind: 'mention', title: 'Mentioned you in a comment' })],
  ];
  for (const [name, next] of apart) {
    it(`adds a new notice ${name}`, async () => {
      const { store, send } = setup();
      await send(comment());
      await expect(send(next)).resolves.toMatchObject({ grouped: false });
      expect(store.records).toHaveLength(2);
    });
  }

  it('never groups mentions', async () => {
    const { store, send } = setup();
    const mention = comment({ kind: 'mention', title: 'Mentioned you in a comment' });
    await send(mention);
    await expect(send(mention)).resolves.toMatchObject({ grouped: false });
    expect(store.records.map((notice) => notice.groupKey)).toEqual([null, null]);
  });

  it('adds a new notice 5 minutes after the last one', async () => {
    const { store, send, wait } = setup();
    await send(comment());
    wait(5 * MINUTE);
    await expect(send(comment())).resolves.toMatchObject({ grouped: false });
    expect(store.records.map((notice) => notice.count)).toEqual([1, 1]);
  });
});

describe('unread counts and privacy', () => {
  it("counts and marks only the person's own chat", async () => {
    const { store, send } = setup();
    const first = await send(comment({ groupKey: undefined }));
    const second = await send(comment({ groupKey: undefined }));
    await send(comment({ groupKey: undefined }));
    const samsNotice = await send(comment({ userId: sam, groupKey: undefined }));
    await send(comment({ workspaceId: otherWorkspaceId, groupKey: undefined }));
    const now = new Date();

    expect(await store.countUnread(averysChat)).toBe(3);
    expect(await store.markRead(averysChat, { noticeIds: [first.noticeId] }, now)).toBe(1);
    expect(await store.markRead(averysChat, { noticeIds: [first.noticeId] }, now)).toBe(0);
    // Someone else's notice can't be marked from Avery's chat.
    expect(await store.markRead(averysChat, { noticeIds: [samsNotice.noticeId] }, now)).toBe(0);
    expect(await store.countUnread(averysChat)).toBe(2);

    const chat = await store.list(averysChat, { limit: 10 });
    const secondPosition = chat.find((notice) => notice.id === second.noticeId)?.position ?? 0;
    expect(await store.markRead(averysChat, { through: secondPosition }, now)).toBe(1);
    expect(await store.countUnread(averysChat)).toBe(1);
    expect(await store.countUnread({ workspaceId, userId: sam })).toBe(1);
    expect(await store.countUnread({ workspaceId: otherWorkspaceId, userId: avery })).toBe(1);

    // Mark all as read: the whole chat, and only that chat.
    expect(await store.markRead(averysChat, { all: true }, now)).toBe(1);
    expect(await store.countUnread(averysChat)).toBe(0);
    expect(await store.countUnread({ workspaceId, userId: sam })).toBe(1);
    expect(await store.countUnread({ workspaceId: otherWorkspaceId, userId: avery })).toBe(1);
  });

  it('lists only the notices a filter chip shows', async () => {
    const { store, send } = setup();
    const kinds = ['mention', 'comment', 'reminder', 'access_request', 'alert', 'reply'] as const;
    for (const kind of kinds) await send(comment({ kind, title: kind, groupKey: undefined }));
    const [reminder] = await store.list(averysChat, { limit: 1, filter: 'reminders' });
    await store.markRead(averysChat, { noticeIds: [reminder?.id ?? ''] }, new Date());
    const titles = async (filter: NoticeFilter) =>
      (await store.list(averysChat, { limit: 10, filter })).map((notice) => notice.title);

    expect(await titles('all')).toEqual([
      'reply',
      'alert',
      'access_request',
      'reminder',
      'comment',
      'mention',
    ]);
    expect(await titles('mentions')).toEqual(['reply', 'mention']);
    expect(await titles('following')).toEqual(['comment']);
    expect(await titles('reminders')).toEqual(['reminder']);
    expect(await titles('requests')).toEqual(['access_request']);
    expect(await titles('unread')).toEqual([
      'reply',
      'alert',
      'access_request',
      'comment',
      'mention',
    ]);
  });

  it("lists a chat newest first, a page at a time, without other people's notices", async () => {
    const { store, send } = setup();
    for (const title of ['First', 'Second', 'Third']) {
      await send(comment({ title, groupKey: undefined }));
    }
    await send(comment({ userId: sam, title: 'For Sam', groupKey: undefined }));

    const page = await store.list(averysChat, { limit: 2 });
    expect(page.map((notice) => notice.title)).toEqual(['Third', 'Second']);
    const rest = await store.list(averysChat, { limit: 2, before: page.at(-1)?.position });
    expect(rest.map((notice) => notice.title)).toEqual(['First']);
  });

  it('gets a notice for its owner, and nobody else owns it, admins included', async () => {
    const { store, send } = setup();
    const { noticeId } = await send(comment());
    const notice = await store.get(noticeId);
    expect(notice).toMatchObject({ id: noticeId, ...averysChat, title: 'Commented on a page' });
    expect(notice && isNoticeOwner(notice, averysChat)).toBe(true);
    // Sam is an admin of Care Team Demo.
    expect(notice && isNoticeOwner(notice, { workspaceId, userId: sam })).toBe(false);
    expect(await store.get('3f1c2d4e-0000-4000-8000-00000000ffff')).toBeNull();
  });
});

describe('idempotency keys', () => {
  it('adds nothing and tells no one when a send is retried with the same key', async () => {
    const { store, emitted, published, send } = setup();
    const first = await send(comment({ idempotencyKey: 'comments:c-1' }));
    const retry = await send(comment({ idempotencyKey: 'comments:c-1', text: 'Edited.' }));
    expect(retry).toEqual({ noticeId: first.noticeId, grouped: false, duplicate: true });
    expect(store.records.map((notice) => [notice.text, notice.count])).toEqual([
      ['Looks good to me.', 1],
    ]);
    expect(emitted).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it('keeps keys apart for each person and workspace', async () => {
    const { store, send } = setup();
    const key = 'reminders:r-1:2026-11-02T09:00';
    for (const input of [
      comment({ idempotencyKey: key }),
      comment({ userId: riley, idempotencyKey: key }),
      comment({ workspaceId: otherWorkspaceId, idempotencyKey: key }),
    ]) {
      expect((await send(input)).duplicate).toBeUndefined();
    }
    expect(store.records).toHaveLength(3);
  });

  it('returns the grouped notice for a key whose send was grouped', async () => {
    const { send, wait } = setup();
    const first = await send(comment());
    wait(MINUTE);
    const grouped = await send(comment({ idempotencyKey: 'comments:c-2' }));
    expect(grouped).toEqual({ noticeId: first.noticeId, grouped: true });
    await expect(send(comment({ idempotencyKey: 'comments:c-2' }))).resolves.toEqual({
      noticeId: first.noticeId,
      grouped: false,
      duplicate: true,
    });
  });
});

describe('membership', () => {
  it("drops notices for people who aren't in the workspace", async () => {
    const asked: [string, string][] = [];
    const { store, log, send } = setup({
      isMember: async (inWorkspace, userId) => {
        asked.push([inWorkspace, userId]);
        return userId !== riley;
      },
    });
    await expect(send(comment({ userId: riley }))).resolves.toEqual({
      noticeId: '',
      grouped: false,
      dropped: true,
    });
    expect(store.records).toHaveLength(0);
    expect(log).toEqual([]);
    await expect(send(comment())).resolves.toMatchObject({ grouped: false });
    expect(asked).toEqual([
      [workspaceId, riley],
      [workspaceId, avery],
    ]);
  });

  it('still checks the input first', async () => {
    const { send } = setup({ isMember: async () => false });
    await expect(send(comment({ title: '' }))).rejects.toBeInstanceOf(NoticeInputError);
  });
});

describe('sendNotice', () => {
  it('needs the notices routes to be running', async () => {
    await expect(sendNotice(comment())).rejects.toThrow("Notices aren't running");
  });

  it('sends through the runtime the app bound, until it unbinds', async () => {
    const { store, runtime } = setup();
    const unbind = bindNoticesRuntime(runtime);
    await expect(sendNotice(comment())).resolves.toMatchObject({ grouped: false });
    expect(store.records).toHaveLength(1);
    unbind();
    await expect(sendNotice(comment())).rejects.toThrow("Notices aren't running");
  });

  it('keeps the newest runtime when an older app closes', async () => {
    const older = setup();
    const newer = setup();
    const unbindOlder = bindNoticesRuntime(older.runtime);
    const unbindNewer = bindNoticesRuntime(newer.runtime);
    unbindOlder();
    await sendNotice(comment());
    expect(older.store.records).toHaveLength(0);
    expect(newer.store.records).toHaveLength(1);
    unbindNewer();
  });

  it('can save to memory in unit tests of other features', async () => {
    const { store, unbind } = bindMemoryNotices();
    try {
      await sendNotice(comment({ kind: 'mention', title: 'Mentioned you in a comment' }));
      expect(store.records.map((notice) => notice.title)).toEqual(['Mentioned you in a comment']);
    } finally {
      unbind();
    }
  });
});
