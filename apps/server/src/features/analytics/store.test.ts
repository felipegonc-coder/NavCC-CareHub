import { randomUUID } from 'node:crypto';
import { combine, toInstant } from '@carehub/team-time';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp, type TestUser } from '../../testing';
import type { ActivityKind } from './domain/activity';
import { customRange, daySpans, deleteBefore, presetRange, type PresetDays } from './domain/range';
import { cleanUp, getOverview, recordActivity, savePage } from './store';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DENVER = 'America/Denver';
const TODAY = '2026-10-27';

describe.skipIf(!hasDatabase)('analytics store', () => {
  let t: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  const workspaceId = randomUUID();
  const refundPolicy = randomUUID();
  const onboarding = randomUUID();
  const supportSpace = randomUUID();
  const trainingSpace = randomUUID();
  const start = new Date('2026-10-20T15:00:00Z');
  const minute = (n: number) => new Date(start.getTime() + n * MINUTE_MS);
  const denver = (day: string, time: string) => toInstant(combine(day, time), DENVER);

  const select = async <Row>(query: SQL) => (await t.db.execute(query)).rows as unknown as Row[];
  const activityCount = async (where: SQL = sql`TRUE`) =>
    (
      await select<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM analytics_activity WHERE ${where}`,
      )
    )[0]?.n;
  const record = (user: TestUser, pageId: string, kind: ActivityKind, at: Date) =>
    recordActivity(t.db, { workspaceId, userId: user.id, pageId, kind, at });
  const overview = (
    days: PresetDays,
    timeZone = DENVER,
    filter: { userId?: string; spaceId?: string } = {},
  ) =>
    getOverview(t.db, {
      workspaceId,
      days: daySpans(presetRange(days, TODAY), timeZone),
      ...filter,
    });

  beforeAll(async () => {
    t = await createTestApp();
    avery = await createUser(t.db, { name: 'Avery Lin', email: 'avery@example.com' });
    sam = await createUser(t.db, { name: 'Sam Ortiz', email: 'sam@example.com' });
    riley = await createUser(t.db, { name: 'Riley Chen', email: 'riley@example.com' });
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(async () => {
    await t.db.execute(sql`TRUNCATE analytics_activity, analytics_last_counted, analytics_pages`);
  });

  describe('counting once', () => {
    it('AN-01: three opens within 30 minutes count once; one at 31 minutes counts', async () => {
      const counted: boolean[] = [];
      for (const n of [0, 10, 20, 31])
        counted.push(await record(avery, refundPolicy, 'view', minute(n)));
      expect(counted).toEqual([true, false, false, true]);
      expect(await activityCount()).toBe(2);
    });

    it('starts the 30 minutes again from the open that counted', async () => {
      const counted: boolean[] = [];
      for (let n = 0; n <= 80; n += 20)
        counted.push(await record(avery, refundPolicy, 'view', minute(n)));
      expect(counted).toEqual([true, false, true, false, true]);
    });

    it('AN-02: changes within 10 minutes count once', async () => {
      const counted: boolean[] = [];
      for (const n of [0, 4, 9, 10, 15])
        counted.push(await record(sam, refundPolicy, 'edit', minute(n)));
      expect(counted).toEqual([true, false, false, true, false]);
      expect(await activityCount(sql`kind = 'edit'`)).toBe(2);
    });

    it('counts each person, page and kind on its own', async () => {
      expect(await record(avery, refundPolicy, 'view', minute(0))).toBe(true);
      expect(await record(sam, refundPolicy, 'view', minute(1))).toBe(true);
      expect(await record(avery, onboarding, 'view', minute(2))).toBe(true);
      expect(await record(avery, refundPolicy, 'edit', minute(3))).toBe(true);
      expect(await record(avery, refundPolicy, 'view', minute(4))).toBe(false);
    });

    it('counts every create, delete and restore', async () => {
      for (const kind of ['create', 'delete', 'restore', 'delete', 'restore'] as const) {
        expect(await record(avery, refundPolicy, kind, minute(0))).toBe(true);
      }
      expect(await activityCount()).toBe(5);
    });

    it('counts opens at the same moment once, as from two tabs', async () => {
      const counted = await Promise.all(
        Array.from({ length: 5 }, () => record(riley, refundPolicy, 'view', minute(0))),
      );
      expect(counted.filter(Boolean)).toHaveLength(1);
      expect(await activityCount()).toBe(1);
    });
  });

  describe('overview', () => {
    beforeEach(async () => {
      await savePage(t.db, {
        pageId: refundPolicy,
        workspaceId,
        title: 'Refund policy',
        spaceId: supportSpace,
        state: 'live',
      });
      await savePage(t.db, {
        pageId: onboarding,
        workspaceId,
        title: 'Onboarding checklist',
        spaceId: trainingSpace,
        state: 'trash',
      });
      const activity: [TestUser, string, ActivityKind, Date][] = [
        [avery, refundPolicy, 'view', denver('2026-10-21', '09:00')],
        [sam, refundPolicy, 'view', denver('2026-10-21', '10:00')],
        [sam, onboarding, 'create', denver('2026-10-22', '07:59')],
        [sam, onboarding, 'edit', denver('2026-10-22', '08:00')],
        [avery, refundPolicy, 'edit', denver('2026-10-23', '11:00')],
        [avery, refundPolicy, 'edit', denver('2026-10-23', '11:30')],
        // A minute before the 7 days start in Denver, but inside them in UTC.
        [riley, onboarding, 'view', denver('2026-10-20', '23:59')],
        [riley, onboarding, 'view', denver('2026-10-26', '00:00')],
        [riley, refundPolicy, 'edit', denver('2026-10-27', '08:00')],
        // October 28 in UTC.
        [avery, refundPolicy, 'view', denver('2026-10-27', '23:30')],
        [avery, onboarding, 'view', denver('2026-10-07', '12:00')],
        [avery, onboarding, 'view', denver('2026-08-28', '12:00')],
        [avery, onboarding, 'view', denver('2026-07-29', '23:59')],
      ];
      activity.sort((a, b) => a[3].getTime() - b[3].getTime());
      for (const [user, pageId, kind, at] of activity) {
        expect(await record(user, pageId, kind, at)).toBe(true);
      }
    });

    it('AN-04: gives exact numbers for the last 7 days in the viewer’s time zone', async () => {
      const week = await overview(7);
      expect(week.totals).toEqual({ activePeople: 3, views: 4, edits: 4, created: 1 });
      expect(week.days).toEqual([
        { day: '2026-10-21', activePeople: 2, views: 2, edits: 0, created: 0 },
        { day: '2026-10-22', activePeople: 1, views: 0, edits: 1, created: 1 },
        { day: '2026-10-23', activePeople: 1, views: 0, edits: 2, created: 0 },
        { day: '2026-10-24', activePeople: 0, views: 0, edits: 0, created: 0 },
        { day: '2026-10-25', activePeople: 0, views: 0, edits: 0, created: 0 },
        { day: '2026-10-26', activePeople: 1, views: 1, edits: 0, created: 0 },
        { day: '2026-10-27', activePeople: 2, views: 1, edits: 1, created: 0 },
      ]);
      expect(week.topPages).toEqual([
        { pageId: refundPolicy, title: 'Refund policy', state: 'live', views: 3, viewers: 2 },
        { pageId: onboarding, title: 'Onboarding checklist', state: 'trash', views: 1, viewers: 1 },
      ]);
      expect(week.topEditors).toEqual([
        { userId: avery.id, name: 'Avery Lin', edits: 2 },
        { userId: riley.id, name: 'Riley Chen', edits: 1 },
        { userId: sam.id, name: 'Sam Ortiz', edits: 1 },
      ]);
    });

    it('AN-04: gives exact numbers for 30 and 90 days', async () => {
      expect((await overview(30)).totals).toEqual({
        activePeople: 3,
        views: 6,
        edits: 4,
        created: 1,
      });
      expect((await overview(90)).totals).toEqual({
        activePeople: 3,
        views: 7,
        edits: 4,
        created: 1,
      });
    });

    it('follows the viewer’s time zone for days', async () => {
      const week = await overview(7, 'UTC');
      expect(week.days[0]).toEqual({
        day: '2026-10-21',
        activePeople: 3,
        views: 3,
        edits: 0,
        created: 0,
      });
      expect(week.days.at(-1)).toEqual({
        day: '2026-10-27',
        activePeople: 1,
        views: 0,
        edits: 1,
        created: 0,
      });
    });

    it('filters by person and by space', async () => {
      const sams = await overview(7, DENVER, { userId: sam.id });
      expect(sams.totals).toEqual({ activePeople: 1, views: 1, edits: 1, created: 1 });
      expect(sams.topEditors).toEqual([{ userId: sam.id, name: 'Sam Ortiz', edits: 1 }]);
      const support = await overview(7, DENVER, { spaceId: supportSpace });
      expect(support.totals).toEqual({ activePeople: 3, views: 3, edits: 3, created: 0 });
      expect(support.topPages.map((page) => page.title)).toEqual(['Refund policy']);
    });

    it('keeps the numbers of pages deleted for good', async () => {
      await savePage(t.db, {
        pageId: refundPolicy,
        workspaceId,
        title: 'Refund policy',
        spaceId: supportSpace,
        state: 'deleted',
      });
      expect((await overview(7)).topPages[0]).toMatchObject({ state: 'deleted', views: 3 });
    });

    it('lists pages it never saw the title of as untitled', async () => {
      const unknown = randomUUID();
      await record(sam, unknown, 'view', denver(TODAY, '12:00'));
      expect((await overview(7)).topPages).toContainEqual({
        pageId: unknown,
        title: '',
        state: null,
        views: 1,
        viewers: 1,
      });
    });
  });

  it('AN-07: the clean-up deletes activity older than the kept period', async () => {
    const now = new Date('2026-10-27T12:00:00Z');
    const old = new Date(deleteBefore(now).getTime() - MINUTE_MS);
    const goneForGood = randomUUID();
    await savePage(t.db, {
      pageId: goneForGood,
      workspaceId,
      title: 'Old notes',
      spaceId: null,
      state: 'deleted',
    });
    await savePage(t.db, {
      pageId: refundPolicy,
      workspaceId,
      title: 'Refund policy',
      spaceId: null,
      state: 'deleted',
    });
    await record(riley, goneForGood, 'view', old);
    await record(avery, refundPolicy, 'create', old);
    await record(avery, refundPolicy, 'edit', deleteBefore(now));
    await record(sam, onboarding, 'view', new Date(now.getTime() - 2 * DAY_MS));
    await record(sam, refundPolicy, 'view', new Date(now.getTime() - 60 * MINUTE_MS));

    expect(await cleanUp(t.db, now, 1)).toBe(2);
    expect(await activityCount()).toBe(3);
    expect(await activityCount(sql`at < ${deleteBefore(now).toISOString()}::timestamptz`)).toBe(0);
    // Count-once times over a day old go; the page deleted for good goes with its last activity.
    expect(
      await select(sql`SELECT user_id::text, page_id::text FROM analytics_last_counted`),
    ).toEqual([{ user_id: sam.id, page_id: refundPolicy }]);
    expect(await select(sql`SELECT page_id::text FROM analytics_pages`)).toEqual([
      { page_id: refundPolicy },
    ]);
  });

  it('AN-08: Overview of a year of activity for 30 people takes under 2 seconds', async () => {
    const now = denver(TODAY, '12:00');
    // 20 a day for each person (3 views to 1 edit) on 200 pages: 219,000 in all.
    await t.db.execute(
      sql`WITH people AS (
              INSERT INTO users (email, name)
              SELECT 'person-' || i || '@example.com', 'Person ' || i
              FROM generate_series(1, 30) AS i
              RETURNING id
            )
            INSERT INTO analytics_activity (workspace_id, user_id, page_id, kind, at)
            SELECT ${workspaceId}::uuid, people.id, md5((g % 200)::text)::uuid,
              CASE WHEN g % 4 = 0 THEN 'edit' ELSE 'view' END,
              ${now.toISOString()}::timestamptz - g * interval '72 minutes'
            FROM people CROSS JOIN generate_series(0, 7299) AS g`,
    );
    await t.db.execute(sql`ANALYZE analytics_activity`);
    const year = customRange('2000-01-01', TODAY, TODAY);
    if (!year) throw new Error('The kept year should be a range.');
    for (const range of [presetRange(7, TODAY), presetRange(90, TODAY), year]) {
      const started = performance.now();
      const result = await getOverview(t.db, { workspaceId, days: daySpans(range, DENVER) });
      expect(performance.now() - started).toBeLessThan(2000);
      expect(result.totals.activePeople).toBe(30);
      expect(result.topPages).toHaveLength(10);
    }
  }, 120_000);
});
