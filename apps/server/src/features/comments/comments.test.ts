import { randomUUID } from 'node:crypto';
import type { AccessLevel, CommentsResponse, CreateCommentResponse } from '@carehub/shared';
import { sql } from 'drizzle-orm';
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
import { listComments, type CommentCreatedEvent } from './index';
import { bindCommentPages } from './pages';
import { comments, commentThreads } from './schema';

const workspaceId = randomUUID();
/** The stand-in page model: each test's own pages, with each person's level on them. */
const pages = new Map<string, Map<string, AccessLevel>>();

describe.skipIf(!hasDatabase)('comments on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  let unbind: (() => void) | undefined;
  const created: CommentCreatedEvent[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    unbind = bindCommentPages(async (_db, userId, pageId) => {
      const levels = pages.get(pageId);
      return levels ? { workspaceId, level: levels.get(userId) ?? 'none' } : null;
    });
    test.app.events.on('comment.created', (event) => {
      created.push(event);
    });
  });
  afterAll(async () => {
    unbind?.();
    await test?.close();
  });

  function newPage(levels: [TestUser, AccessLevel][]) {
    const id = randomUUID();
    pages.set(id, new Map(levels.map(([user, level]) => [user.id, level])));
    return id;
  }
  /** Avery can edit, Sam can comment, Riley can view. */
  const teamPage = () =>
    newPage([
      [avery, 'edit'],
      [sam, 'comment'],
      [riley, 'view'],
    ]);
  const call = (
    user: TestUser,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  async function threadsOf(user: TestUser, pageId: string, status = 'all') {
    const response = await call(user, 'GET', `/api/comments?pageId=${pageId}&status=${status}`);
    expect(response.statusCode).toBe(200);
    return response.json() as CommentsResponse;
  }
  async function comment(user: TestUser, body: object): Promise<CreateCommentResponse> {
    const response = await call(user, 'POST', '/api/comments', body);
    expect(response.statusCode).toBe(201);
    return response.json();
  }
  const resolve = (user: TestUser, threadId: string, resolved: boolean) =>
    call(user, 'PATCH', `/api/comments/threads/${threadId}`, { resolved });

  it('adds a text comment and a reply that everyone who can open the page sees (CM-01)', async () => {
    const pageId = teamPage();
    const first = await comment(avery, {
      pageId,
      text: 'Is 3 days right?',
      blockId: 'refund-steps',
      quote: 'within 3 days',
    });
    const replyText = `<@${riley.id}> yes, 3 working days <@not-a-person>`;
    const reply = await comment(sam, { pageId, threadId: first.threadId, text: replyText });
    expect(reply.threadId).toBe(first.threadId);

    for (const viewer of [avery, sam, riley]) {
      const { threads, people } = await threadsOf(viewer, pageId);
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({
        pageId,
        spot: 'text',
        blockId: 'refund-steps',
        quote: 'within 3 days',
        createdBy: avery.id,
        resolvedAt: null,
      });
      expect(threads[0]?.comments.map((c) => [c.authorId, c.text])).toEqual([
        [avery.id, 'Is 3 days right?'],
        [sam.id, replyText],
      ]);
      expect(
        Object.values(people)
          .map((person) => person.name)
          .sort(),
      ).toEqual(['Avery Lin', 'Riley Chen', 'Sam Ortiz']);
    }

    await test.app.events.settled();
    expect(created.filter((event) => event.pageId === pageId)).toEqual([
      {
        commentId: first.id,
        threadId: first.threadId,
        pageId,
        workspaceId,
        by: avery.id,
        newThread: true,
      },
      {
        commentId: reply.id,
        threadId: first.threadId,
        pageId,
        workspaceId,
        by: sam.id,
        newThread: false,
      },
    ]);
  });

  it('puts threads on the page, a block or a property, the newest activity first', async () => {
    const pageId = teamPage();
    const onPage = await comment(sam, { pageId, text: 'About the whole page' });
    const onBlock = await comment(sam, { pageId, text: 'About this block', blockId: 'b1' });
    const onProperty = await comment(sam, { pageId, text: 'Status?', propertyId: 'status' });
    const { threads, canComment } = await threadsOf(sam, pageId);
    expect(canComment).toBe(true);
    expect(threads.map((t) => [t.id, t.spot, t.blockId, t.propertyId, t.quote])).toEqual([
      [onProperty.threadId, 'property', null, 'status', null],
      [onBlock.threadId, 'block', 'b1', null, null],
      [onPage.threadId, 'page', null, null, null],
    ]);
    expect((await threadsOf(riley, pageId)).canComment).toBe(false);
    const newest = await listComments(test.db, sam.id, pageId, { limit: 1 });
    expect(newest.map((thread) => thread.id)).toEqual([onProperty.threadId]);
  });

  it('lets authors edit and delete only their own comments (CM-01)', async () => {
    const pageId = teamPage();
    const first = await comment(avery, { pageId, text: 'First' });
    const reply = await comment(sam, { pageId, threadId: first.threadId, text: 'Second' });
    const url = `/api/comments/${reply.id}`;
    expect((await call(avery, 'PATCH', url, { text: 'Changed' })).statusCode).toBe(403);
    expect((await call(sam, 'PATCH', url, { text: 'x'.repeat(4001) })).statusCode).toBe(400);
    const edited = await call(sam, 'PATCH', url, { text: ' Second, changed ' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().editedAt).toEqual(expect.any(String));
    expect((await call(avery, 'DELETE', url)).statusCode).toBe(403);

    let [thread] = (await threadsOf(avery, pageId)).threads;
    expect(
      thread?.comments.map((c) => [c.text, c.editedAt !== null, c.canEdit, c.canDelete]),
    ).toEqual([
      ['First', false, true, true],
      ['Second, changed', true, false, false],
    ]);

    // The first comment stays as "This comment was deleted" while the thread has replies.
    expect((await call(avery, 'DELETE', `/api/comments/${first.id}`)).statusCode).toBe(204);
    [thread] = (await threadsOf(sam, pageId)).threads;
    expect(thread?.comments.map((c) => [c.text, c.deleted, c.canEdit])).toEqual([
      ['', true, false],
      ['Second, changed', false, true],
    ]);
    expect(
      (await call(avery, 'PATCH', `/api/comments/${first.id}`, { text: 'Back' })).statusCode,
    ).toBe(404);

    // With no comments left, the thread goes.
    expect((await call(sam, 'DELETE', url)).statusCode).toBe(204);
    expect((await threadsOf(sam, pageId)).threads).toEqual([]);
  });

  it("lets people with Full access delete anyone's comment", async () => {
    const pageId = newPage([
      [avery, 'full'],
      [sam, 'comment'],
    ]);
    const first = await comment(sam, { pageId, text: 'One' });
    const second = await comment(sam, { pageId, threadId: first.threadId, text: 'Two' });
    const third = await comment(avery, { pageId, threadId: first.threadId, text: 'Three' });
    expect((await call(sam, 'DELETE', `/api/comments/${third.id}`)).statusCode).toBe(403);
    expect((await call(avery, 'DELETE', `/api/comments/${second.id}`)).statusCode).toBe(204);
    const [thread] = (await threadsOf(sam, pageId)).threads;
    expect(thread?.comments.map((c) => [c.text, c.canDelete])).toEqual([
      ['One', true],
      ['Three', false],
    ]);
  });

  it('needs Can view to read and Can comment to comment (403 otherwise)', async () => {
    const pageId = newPage([
      [avery, 'edit'],
      [sam, 'view'],
      [riley, 'none'],
    ]);
    const { id, threadId } = await comment(avery, { pageId, text: 'Private plans' });
    expect((await call(sam, 'GET', `/api/comments?pageId=${pageId}`)).statusCode).toBe(200);
    expect((await call(sam, 'POST', '/api/comments', { pageId, text: 'Me too' })).statusCode).toBe(
      403,
    );
    const reply = await call(sam, 'POST', '/api/comments', { pageId, threadId, text: 'Me too' });
    expect(reply.statusCode).toBe(403);

    const closed = await call(riley, 'GET', `/api/comments?pageId=${pageId}`);
    expect(closed.statusCode).toBe(403);
    expect(closed.body).not.toContain('Private plans');
    expect(
      (await call(riley, 'PATCH', `/api/comments/${id}`, { text: 'Mine now' })).statusCode,
    ).toBe(404);
    expect((await resolve(riley, threadId, true)).statusCode).toBe(404);
    expect(await listComments(test.db, riley.id, pageId)).toEqual([]);
    expect(await listComments(test.db, sam.id, pageId)).toHaveLength(1);

    const missing = `/api/comments?pageId=${randomUUID()}`;
    expect((await call(avery, 'GET', missing)).statusCode).toBe(404);
    expect((await test.app.inject({ method: 'GET', url: missing })).statusCode).toBe(401);
  });

  it("won't reply in a thread from another page", async () => {
    const pageId = teamPage();
    const { threadId } = await comment(sam, { pageId: teamPage(), text: 'Elsewhere' });
    const response = await call(sam, 'POST', '/api/comments', { pageId, threadId, text: 'Here' });
    expect(response.statusCode).toBe(404);
  });

  it('resolves for the starter or editors, and replying reopens (CM-03)', async () => {
    const pageId = teamPage();
    const mine = await comment(sam, { pageId, text: 'Sam asks', blockId: 'b1', quote: 'Refunds' });
    const theirs = await comment(avery, { pageId, text: 'Avery asks' });
    expect((await resolve(riley, mine.threadId, true)).statusCode).toBe(403);
    expect((await resolve(sam, theirs.threadId, true)).statusCode).toBe(403);
    const done = await resolve(sam, mine.threadId, true);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ id: mine.threadId, resolvedBy: sam.id });
    expect((await resolve(avery, theirs.threadId, true)).statusCode).toBe(200);

    expect((await threadsOf(riley, pageId, 'open')).threads).toEqual([]);
    const resolved = (await threadsOf(sam, pageId, 'resolved')).threads;
    expect(Object.fromEntries(resolved.map((t) => [t.id, t.canResolve]))).toEqual({
      [mine.threadId]: true,
      [theirs.threadId]: false,
    });

    await comment(sam, { pageId, threadId: theirs.threadId, text: 'One more thing' });
    const open = (await threadsOf(sam, pageId, 'open')).threads;
    expect(open.map((t) => [t.id, t.resolvedAt, t.resolvedBy])).toEqual([
      [theirs.threadId, null, null],
    ]);
    const reopened = await resolve(sam, mine.threadId, false);
    expect(reopened.json()).toEqual({ id: mine.threadId, resolvedAt: null, resolvedBy: null });
  });

  it('keeps to 4,000 characters, 500 comments a thread and 1,000 threads a page', async () => {
    const pageId = teamPage();
    const post = (body: object) => call(sam, 'POST', '/api/comments', { pageId, ...body });
    expect((await post({ text: 'a'.repeat(4001) })).statusCode).toBe(400);
    expect((await post({ text: ' \n ' })).statusCode).toBe(400);
    const { threadId } = await comment(sam, { pageId, text: '😀'.repeat(4000) });

    await test.db
      .insert(comments)
      .values(Array.from({ length: 499 }, () => ({ threadId, authorId: sam.id, body: 'More' })));
    const fullThread = await post({ threadId, text: 'One too many' });
    expect(fullThread.statusCode).toBe(413);
    expect(fullThread.json().error.code).toBe('too_large');

    const thread = { workspaceId, pageId, spot: 'page' as const, createdBy: sam.id };
    await test.db.insert(commentThreads).values(Array.from({ length: 999 }, () => thread));
    expect((await post({ text: 'Thread 1,001' })).statusCode).toBe(413);
  });

  it('creates the comment tables exactly as the Drizzle definitions describe them', async () => {
    for (const table of [commentThreads, comments]) {
      const config = getTableConfig(table);
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
      expect(inDatabase, config.name).toEqual(inDrizzle);
    }
  });
});
