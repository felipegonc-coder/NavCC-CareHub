import { describe, expect, it } from 'vitest';
import { chatLockKey, GROUP_WINDOW_MS, planNotice } from './grouping';

const noticeId = '3f1c2d4e-0000-4000-8000-00000000a001';
const latestAt = new Date('2026-10-27T09:00:00.000Z');
const after = (ms: number) => new Date(latestAt.getTime() + ms);

describe('planNotice', () => {
  it('adds a notice when there is nothing to group with', () => {
    expect(planNotice(null, latestAt)).toEqual({ type: 'insert' });
  });

  it('groups within 5 minutes of the last arrival and counts it', () => {
    const candidate = { id: noticeId, latestAt, count: 1 };
    expect(planNotice(candidate, after(0))).toEqual({ type: 'group', noticeId, count: 2 });
    expect(planNotice({ ...candidate, count: 4 }, after(GROUP_WINDOW_MS - 1))).toEqual({
      type: 'group',
      noticeId,
      count: 5,
    });
  });

  it('adds a new notice from 5 minutes on', () => {
    const candidate = { id: noticeId, latestAt, count: 3 };
    expect(GROUP_WINDOW_MS).toBe(5 * 60 * 1000);
    expect(planNotice(candidate, after(GROUP_WINDOW_MS))).toEqual({ type: 'insert' });
    expect(planNotice(candidate, after(60 * 60 * 1000))).toEqual({ type: 'insert' });
  });

  it('still groups with a notice from a clock that ran ahead', () => {
    expect(planNotice({ id: noticeId, latestAt: after(30_000), count: 1 }, latestAt)).toEqual({
      type: 'group',
      noticeId,
      count: 2,
    });
  });
});

describe('chatLockKey', () => {
  it('is different for each person and workspace, and the same for the same chat', () => {
    const chat = {
      workspaceId: '3f1c2d4e-0000-4000-8000-00000000c0de',
      userId: '3f1c2d4e-0000-4000-8000-0000000a7e51',
    };
    const keys = new Set([
      chatLockKey(chat),
      chatLockKey({ ...chat, userId: '3f1c2d4e-0000-4000-8000-00000000005a' }),
      chatLockKey({ ...chat, workspaceId: '3f1c2d4e-0000-4000-8000-00000000c0df' }),
    ]);
    expect(keys.size).toBe(3);
    expect(chatLockKey({ ...chat })).toBe(chatLockKey(chat));
  });
});
