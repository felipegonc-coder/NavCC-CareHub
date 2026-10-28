import { randomUUID } from 'node:crypto';
import type {
  AccessLevel,
  CanOpenResponse,
  CreateCommentResponse,
  CreateMentionResponse,
} from '@carehub/shared';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { bindCommentPages } from '../comments/pages';
import { drainJobsForTest, pauseJobsForTest } from '../jobs/testing';
import { bindMemoryNotices, type MemoryNoticeStore } from '../notices/testing';
import type { MentionCreatedEvent } from './index';
import { mentions } from './schema';
import { PAGE_MENTION_LIMITS } from './service';

const workspaceId = randomUUID();
/** The stand-in page model: each test's own pages, with each person's level on them. */
const pages = new Map<string, Map<string, AccessLevel>>();
const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000);

describe.skipIf(!hasDatabase)('mentions on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let kai: TestUser;
  let riley: TestUser;
  let notices: MemoryNoticeStore;
  const unbinds: (() => void)[] = [];
  const created: MentionCreatedEvent[] = [];
  let resumeJobs: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    test = await createTestApp();
    // Notices go only when a test drains the jobs: the app's own runner could otherwise send one
    // between a test's steps, or while drainJobsForTest is looking.
    resumeJobs = await pauseJobsForTest();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    kai = await createUser(test.db, { name: 'Kai Moreno', email: 'kai.moreno@example.test' });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    unbinds.push(
      bindCommentPages(async (_db, userId, pageId) => {
        const levels = pages.get(pageId);
        return levels ? { workspaceId, level: levels.get(userId) ?? 'none' } : null;
      }),
    );
    const memory = bindMemoryNotices();
    notices = memory.store;
    unbinds.push(memory.unbind);
    test.app.events.on('mention.created', (event) => {
      created.push(event);
    });
  });
  afterAll(async () => {
    await resumeJobs?.();
    for (const unbind of unbinds) unbind();
    await test?.close();
  });

  /** Avery can edit, Sam can comment, Kai can view and Riley can't open it. */
  function teamPage() {
    const id = randomUUID();
    const levels: [TestUser, AccessLevel][] = [
      [avery, 'edit'],
      [sam, 'comment'],
      [kai, 'view'],
    ];
    pages.set(id, new Map(levels.map(([user, level]) => [user.id, level])));
    return id;
  }
  const call = (
    user: TestUser,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  async function mention(user: TestUser, body: object, status = 201) {
    const response = await call(user, 'POST', '/api/mentions', body);
    expect(response.statusCode).toBe(status);
    return (response.json() as CreateMentionResponse).mention;
  }
  /** The notices a person got about the page. */
  const noticesOn = (user: TestUser, pageId: string) =>
    notices.records.filter(
      (notice) =>
        notice.userId === user.id && notice.card?.type === 'page' && notice.card.pageId === pageId,
    );
  async function statusOf(mentionId: string) {
    const [row] = await test.db
      .select({ status: mentions.status })
      .from(mentions)
      .where(eq(mentions.id, mentionId));
    return row?.status;
  }

  it('sends one notice for a mention in page text, 10 seconds later (CM-08)', async () => {
    const pageId = teamPage();
    const body = {
      pageId,
      blockId: 'b1',
      userId: sam.id,
      snippet: 'Ask @Sam Ortiz about refunds.',
    };
    const sent = await mention(avery, body);
    expect(sent).toMatchObject({ pageId, blockId: 'b1', commentId: null, userId: sam.id });
    expect(sent.status).toBe('waiting');
    expect(Date.parse(sent.sendAt ?? '') - Date.now()).toBeGreaterThan(8_000);
    await test.app.events.settled();
    expect(created).toContainEqual(
      expect.objectContaining({ mentionId: sent.id, by: avery.id, status: 'waiting' }),
    );

    await drainJobsForTest();
    expect(noticesOn(sam, pageId)).toEqual([]);
    await drainJobsForTest({ now: inSeconds(11) });
    expect(noticesOn(sam, pageId)).toEqual([
      expect.objectContaining({
        workspaceId,
        kind: 'mention',
        sender: 'Avery Lin',
        actorUserId: avery.id,
        title: 'Mentioned you on a page',
        text: 'Ask @Sam Ortiz about refunds.',
        buttons: [{ label: 'Open', href: `/p/${pageId}#b1` }],
      }),
    ]);
    expect(await statusOf(sent.id)).toBe('sent');

    // The same person in the same block again soon (an undo and redo): still one notice.
    expect((await mention(avery, body, 200)).id).toBe(sent.id);
    await drainJobsForTest({ now: inSeconds(11) });
    expect(noticesOn(sam, pageId)).toHaveLength(1);
  });

  it('sends nothing when the mention is deleted within 10 seconds (CM-08)', async () => {
    const pageId = teamPage();
    const waiting = await mention(avery, { pageId, blockId: 'b2', userId: kai.id });
    expect((await call(sam, 'DELETE', `/api/mentions/${waiting.id}`)).statusCode).toBe(403);
    expect((await call(riley, 'DELETE', `/api/mentions/${waiting.id}`)).statusCode).toBe(404);
    expect((await call(avery, 'DELETE', `/api/mentions/${waiting.id}`)).statusCode).toBe(204);
    await drainJobsForTest({ now: inSeconds(11) });
    expect(noticesOn(kai, pageId)).toEqual([]);
    expect(await statusOf(waiting.id)).toBe('cancelled');
  });

  it("asks before mentioning someone who can't open the page (CM-09)", async () => {
    const pageId = teamPage();
    const body = { pageId, blockId: 'b3', userId: riley.id };
    const refused = await call(avery, 'POST', '/api/mentions', body);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      error: { code: 'conflict', message: "Riley Chen can't open this page." },
    });
    // Mention without notifying.
    expect(await mention(avery, { ...body, notify: false })).toMatchObject({
      status: 'quiet',
      sendAt: null,
    });
    // Share with Can view, then the mention notifies.
    pages.get(pageId)?.set(riley.id, 'view');
    expect((await mention(avery, body)).status).toBe('waiting');
    await drainJobsForTest({ now: inSeconds(11) });
    expect(noticesOn(riley, pageId)).toHaveLength(1);
  });

  it('checks access again when the notice goes', async () => {
    const pageId = teamPage();
    const waiting = await mention(avery, { pageId, blockId: 'b4', userId: kai.id });
    pages.get(pageId)?.delete(kai.id);
    await drainJobsForTest({ now: inSeconds(11) });
    expect(noticesOn(kai, pageId)).toEqual([]);
    expect(await statusOf(waiting.id)).toBe('no_access');
  });

  it('lets only people who can edit mention in page text, and never notifies yourself', async () => {
    const pageId = teamPage();
    const body = { pageId, blockId: 'b5', userId: kai.id };
    expect((await call(sam, 'POST', '/api/mentions', body)).statusCode).toBe(403);
    expect((await call(riley, 'POST', '/api/mentions', body)).statusCode).toBe(404);
    const stranger = await call(avery, 'POST', '/api/mentions', { ...body, userId: randomUUID() });
    expect(stranger.statusCode).toBe(404);
    expect(await mention(avery, { ...body, userId: avery.id })).toMatchObject({ status: 'quiet' });
    expect(
      (await call(avery, 'POST', '/api/mentions', { ...body, blockId: 'no spaces' })).statusCode,
    ).toBe(400);
  });

  it('stops notifying past 20 page-text mentions a minute or 30 of one person an hour', async () => {
    // Someone new, so the other tests' mentions don't count (#224).
    const jordan = await createUser(test.db, {
      name: 'Jordan Park',
      email: 'jordan.park@example.test',
    });
    const pageId = teamPage();
    pages.get(pageId)?.set(jordan.id, 'edit');
    /** Mentions by Jordan `minutesAgo` that notified `person`, each in its own block. */
    const earlier = (count: number, person: TestUser, minutesAgo: number) => {
      const at = new Date(Date.now() - minutesAgo * 60_000);
      const row = { workspaceId, pageId, userId: person.id, mentionedBy: jordan.id };
      return test.db.insert(mentions).values(
        Array.from({ length: count }, () => ({
          ...row,
          blockId: randomUUID(),
          status: 'sent' as const,
          sentAt: at,
          createdAt: at,
        })),
      );
    };
    const statusOfNew = async (blockId: string, person: TestUser) =>
      (await mention(jordan, { pageId, blockId, userId: person.id })).status;
    const { perMinute, perPersonPerHour } = PAGE_MENTION_LIMITS;

    await earlier(perMinute - 1, kai, 0);
    expect(await statusOfNew('m1', sam)).toBe('waiting');
    expect(await mention(jordan, { pageId, blockId: 'm2', userId: sam.id })).toMatchObject({
      status: 'quiet',
      sendAt: null,
    });

    // Two minutes later, Sam has had 1 notice from Jordan this hour, and gets 28 more.
    const later = (interval: string) =>
      test.db.execute(sql`UPDATE mentions SET created_at = created_at - ${interval}::interval
        WHERE mentioned_by = ${jordan.id}`);
    await later('2 minutes');
    await earlier(perPersonPerHour - 2, sam, 30);
    expect(await statusOfNew('m3', sam)).toBe('waiting');
    expect(await statusOfNew('m4', sam)).toBe('quiet');
    expect(await statusOfNew('m5', kai)).toBe('waiting');
    // An hour later Sam can be notified again.
    await later('1 hour');
    expect(await statusOfNew('m6', sam)).toBe('waiting');

    await drainJobsForTest({ now: inSeconds(11) });
    expect(noticesOn(sam, pageId)).toHaveLength(3);
    expect(noticesOn(kai, pageId)).toHaveLength(1);
  });

  it('notifies the people a comment mentions, once each, but not its author (CM-08)', async () => {
    const pageId = teamPage();
    const text = `<@${avery.id}>, see <@${riley.id}>'s note. <@${sam.id}> <@nobody>`;
    const posted = await call(sam, 'POST', '/api/comments', { pageId, text });
    expect(posted.statusCode).toBe(201);
    const { id: commentId } = posted.json() as CreateCommentResponse;
    await test.app.events.settled();
    await drainJobsForTest();

    expect(noticesOn(avery, pageId)).toEqual([
      expect.objectContaining({
        kind: 'mention',
        sender: 'Sam Ortiz',
        actorUserId: sam.id,
        title: 'Mentioned you in a comment',
        text: "@Avery Lin, see @Riley Chen's note. @Sam Ortiz @(removed)",
        buttons: [{ label: 'Open', href: `/p/${pageId}?comment=${commentId}` }],
      }),
    ]);
    expect(noticesOn(riley, pageId)).toEqual([]);
    expect(noticesOn(sam, pageId)).toEqual([]);
    const statuses = async () => {
      const rows = await test.db.select().from(mentions).where(eq(mentions.commentId, commentId));
      return Object.fromEntries(rows.map((row) => [row.userId, row.status]));
    };
    expect(await statuses()).toEqual({ [avery.id]: 'sent', [riley.id]: 'no_access' });
    expect(created.filter((event) => event.commentId === commentId)).toHaveLength(2);

    // An edit that mentions someone new notifies only them.
    const edited = await call(sam, 'PATCH', `/api/comments/${commentId}`, {
      text: `<@${avery.id}> and <@${kai.id}>, see <@${riley.id}>'s note.`,
    });
    expect(edited.statusCode).toBe(200);
    await test.app.events.settled();
    await drainJobsForTest();
    expect(noticesOn(avery, pageId)).toHaveLength(1);
    expect(noticesOn(kai, pageId)).toEqual([
      expect.objectContaining({ text: "@Avery Lin and @Kai Moreno, see @Riley Chen's note." }),
    ]);
    expect(await statuses()).toEqual({
      [avery.id]: 'sent',
      [kai.id]: 'sent',
      [riley.id]: 'no_access',
    });
  });

  it('sends nothing for a comment deleted before its notice goes', async () => {
    // The notice is due at once; the runner is held (beforeAll), so it waits for the drain.
    const pageId = teamPage();
    const text = `<@${kai.id}> look`;
    const posted = await call(sam, 'POST', '/api/comments', { pageId, text });
    const { id: commentId } = posted.json() as CreateCommentResponse;
    await test.app.events.settled();
    expect((await call(sam, 'DELETE', `/api/comments/${commentId}`)).statusCode).toBe(204);
    await drainJobsForTest();
    expect(noticesOn(kai, pageId)).toEqual([]);
  });

  it('tells the @ menu who can open the page', async () => {
    const pageId = teamPage();
    const url = `/api/mentions/can-open?pageId=${pageId}&userIds=${kai.id},${riley.id}`;
    const answer = await call(sam, 'GET', url);
    expect(answer.statusCode).toBe(200);
    const expected: CanOpenResponse = { canOpen: [kai.id], cantOpen: [riley.id] };
    expect(answer.json()).toEqual(expected);
    expect((await call(kai, 'GET', url)).statusCode).toBe(403);
    expect((await call(riley, 'GET', url)).statusCode).toBe(404);
  });

  it('creates the mentions table exactly as the Drizzle definition describes it', async () => {
    const config = getTableConfig(mentions);
    type Column = { name: string; type: string; not_null: boolean; has_default: boolean };
    const { rows } = await test.db.execute<Column>(sql`
      SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
        attnotnull AS not_null, atthasdef AS has_default
      FROM pg_attribute
      WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`);
    const inDatabase = Object.fromEntries(
      rows.map((row) => [
        row.name,
        { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
      ]),
    );
    const inDrizzle = Object.fromEntries(
      config.columns.map((column) => [
        column.name,
        { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
      ]),
    );
    expect(inDatabase).toEqual(inDrizzle);
  });
});
