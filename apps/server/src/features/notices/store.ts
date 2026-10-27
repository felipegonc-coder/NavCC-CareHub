// The Postgres notice store (decision 0007, section 4.4).
import { and, count, desc, eq, inArray, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db';
import { FILTER_KINDS } from './domain/filters';
import { chatLockKey, planNotice } from './domain/grouping';
import type { ValidNotice } from './domain/validate';
import type { NoticeRecord } from './domain/view';
import { noticeIdempotencyKeys, notices } from './schema';
import type { NoticeScope, NoticeStore } from './service';
import type { SendNoticeResult } from './types';

const inChat = (scope: NoticeScope) =>
  and(eq(notices.workspaceId, scope.workspaceId), eq(notices.userId, scope.userId));

/** The position after every notice's: a grouped notice moves to the end of the chat. */
const nextPosition = () =>
  sql`nextval(pg_get_serial_sequence('notices_notices', 'position')::regclass)`;

/** What a new or grouped notice writes. */
const content = (notice: ValidNotice) => ({
  kind: notice.kind,
  sender: notice.sender,
  actorUserId: notice.actorUserId,
  icon: notice.icon,
  title: notice.title,
  body: notice.text,
  card: notice.card,
  buttons: notice.buttons,
});

function toRecord(row: typeof notices.$inferSelect): NoticeRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    position: row.position,
    kind: row.kind,
    sender: row.sender,
    actorUserId: row.actorUserId,
    icon: row.icon,
    title: row.title,
    text: row.body,
    card: row.card,
    buttons: row.buttons,
    groupKey: row.groupKey,
    count: row.groupCount,
    createdAt: row.createdAt,
    latestAt: row.latestAt,
    readAt: row.readAt,
  };
}

export function createNoticeStore(db: Db): NoticeStore {
  return {
    save(notice, now) {
      return db.transaction(async (tx): Promise<SendNoticeResult> => {
        // One save at a time per chat, so a retry or a burst can't add two notices.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${chatLockKey(notice)}, 0))`,
        );
        const { workspaceId, userId, groupKey, idempotencyKey } = notice;
        if (idempotencyKey !== null) {
          const [earlier] = await tx
            .select({ noticeId: noticeIdempotencyKeys.noticeId })
            .from(noticeIdempotencyKeys)
            .where(
              and(
                eq(noticeIdempotencyKeys.userId, userId),
                eq(noticeIdempotencyKeys.workspaceId, workspaceId),
                eq(noticeIdempotencyKeys.key, idempotencyKey),
              ),
            );
          if (earlier) return { noticeId: earlier.noticeId, grouped: false, duplicate: true };
        }

        const [candidate] =
          groupKey === null
            ? []
            : await tx
                .select({ id: notices.id, latestAt: notices.latestAt, count: notices.groupCount })
                .from(notices)
                .where(and(inChat(notice), eq(notices.groupKey, groupKey)))
                .orderBy(desc(notices.position))
                .limit(1);
        const plan = planNotice(candidate ?? null, now);
        let result: SendNoticeResult;
        if (plan.type === 'group') {
          await tx
            .update(notices)
            .set({
              ...content(notice),
              // To the end of the chat, unread again.
              position: nextPosition(),
              groupCount: plan.count,
              latestAt: now,
              readAt: null,
            })
            .where(eq(notices.id, plan.noticeId));
          result = { noticeId: plan.noticeId, grouped: true };
        } else {
          const [row] = await tx
            .insert(notices)
            .values({
              workspaceId,
              userId,
              ...content(notice),
              groupKey,
              createdAt: now,
              latestAt: now,
            })
            .returning({ id: notices.id });
          if (!row) throw new Error('The notice was not saved.');
          result = { noticeId: row.id, grouped: false };
        }

        if (idempotencyKey !== null) {
          await tx
            .insert(noticeIdempotencyKeys)
            .values({ userId, workspaceId, key: idempotencyKey, noticeId: result.noticeId });
        }
        return result;
      });
    },

    async list(scope, { limit, before, filter = 'all' }) {
      const kinds = FILTER_KINDS[filter];
      const rows = await db
        .select()
        .from(notices)
        .where(
          and(
            inChat(scope),
            before === undefined ? undefined : lt(notices.position, before),
            kinds === null ? undefined : inArray(notices.kind, [...kinds]),
            filter === 'unread' ? isNull(notices.readAt) : undefined,
          ),
        )
        .orderBy(desc(notices.position))
        .limit(limit);
      return rows.map(toRecord);
    },

    async countUnread(scope) {
      const [row] = await db
        .select({ unread: count() })
        .from(notices)
        .where(and(inChat(scope), isNull(notices.readAt)));
      return row?.unread ?? 0;
    },

    async markRead(scope, target, now) {
      let which: SQL | undefined;
      if ('noticeIds' in target) {
        if (target.noticeIds.length === 0) return 0;
        which = inArray(notices.id, [...target.noticeIds]);
      } else if ('through' in target) {
        which = lte(notices.position, target.through);
      }
      const changed = await db
        .update(notices)
        .set({ readAt: now })
        .where(and(inChat(scope), isNull(notices.readAt), which))
        .returning({ id: notices.id });
      return changed.length;
    },

    async get(noticeId) {
      const [row] = await db.select().from(notices).where(eq(notices.id, noticeId)).limit(1);
      return row ? toRecord(row) : null;
    },
  };
}
