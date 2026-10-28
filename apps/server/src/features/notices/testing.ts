// Test helpers for notices: an in-memory store with the same rules as the Postgres one.
import { randomUUID } from 'node:crypto';
import { matchesFilter } from './domain/filters';
import { planNotice } from './domain/grouping';
import type { ValidNotice } from './domain/validate';
import { isNoticeOwner, type NoticeRecord } from './domain/view';
import { bindNoticesRuntime, type NoticeScope, type NoticeStore } from './service';
import type { SendNoticeResult } from './types';

export type MemoryNoticeStore = NoticeStore & { readonly records: NoticeRecord[] };

/**
 * Makes `sendNotice` save to memory, for unit tests that don't start the app. Call `unbind` when
 * the test ends.
 */
export function bindMemoryNotices(): { store: MemoryNoticeStore; unbind: () => void } {
  const store = createMemoryNoticeStore();
  const unbind = bindNoticesRuntime({ store, emit: () => undefined, publish: () => undefined });
  return { store, unbind };
}

export function createMemoryNoticeStore(): MemoryNoticeStore {
  const records: NoticeRecord[] = [];
  /** Idempotency keys, by JSON `[userId, workspaceId, key]`, and the notice each one sent. */
  const keys = new Map<string, string>();
  let lastPosition = 0;
  const chat = (scope: NoticeScope) =>
    records
      .filter((record) => isNoticeOwner(record, scope))
      .sort((a, b) => b.position - a.position);
  const content = (notice: ValidNotice) => ({
    kind: notice.kind,
    sender: notice.sender,
    actorUserId: notice.actorUserId,
    icon: notice.icon,
    title: notice.title,
    text: notice.text,
    card: notice.card,
    extraCards: notice.extraCards,
    buttons: notice.buttons,
  });

  const add = (notice: ValidNotice, now: Date): SendNoticeResult => {
    const candidate =
      notice.groupKey === null
        ? undefined
        : chat(notice).find(
            (record) => record.groupKey === notice.groupKey && record.kind === notice.kind,
          );
    const plan = planNotice(candidate ?? null, now);
    if (plan.type === 'group' && candidate) {
      Object.assign(candidate, content(notice), {
        position: ++lastPosition,
        count: plan.count,
        latestAt: now,
        readAt: null,
      });
      return { noticeId: candidate.id, grouped: true };
    }
    const record: NoticeRecord = {
      id: randomUUID(),
      workspaceId: notice.workspaceId,
      userId: notice.userId,
      ...content(notice),
      groupKey: notice.groupKey,
      position: ++lastPosition,
      count: 1,
      createdAt: now,
      latestAt: now,
      readAt: null,
    };
    records.push(record);
    return { noticeId: record.id, grouped: false };
  };

  return {
    records,
    async save(notice, now) {
      const key =
        notice.idempotencyKey === null
          ? null
          : JSON.stringify([notice.userId, notice.workspaceId, notice.idempotencyKey]);
      const earlier = key === null ? undefined : keys.get(key);
      // Keys last as long as their notice.
      if (earlier !== undefined && records.some((record) => record.id === earlier)) {
        return { noticeId: earlier, grouped: false, duplicate: true };
      }
      const result = add(notice, now);
      if (key !== null) keys.set(key, result.noticeId);
      return result;
    },
    async list(scope, { limit, before, filter = 'all' }) {
      return chat(scope)
        .filter((record) => before === undefined || record.position < before)
        .filter((record) => matchesFilter(filter, record))
        .slice(0, limit)
        .map((record) => ({ ...record }));
    },
    async countUnread(scope) {
      return chat(scope).filter((record) => record.readAt === null).length;
    },
    async markRead(scope, target, now) {
      const ids = 'noticeIds' in target ? new Set(target.noticeIds) : null;
      const through = 'through' in target ? target.through : Number.POSITIVE_INFINITY;
      let changed = 0;
      for (const record of chat(scope)) {
        if (record.readAt !== null) continue;
        if (ids ? !ids.has(record.id) : record.position > through) continue;
        record.readAt = now;
        changed += 1;
      }
      return changed;
    },
    async get(noticeId) {
      const record = records.find((candidate) => candidate.id === noticeId);
      return record ? { ...record } : null;
    },
  };
}
