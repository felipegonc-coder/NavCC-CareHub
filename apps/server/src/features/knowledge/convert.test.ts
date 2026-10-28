import { randomUUID } from 'node:crypto';
import {
  KB_PROPERTY,
  KB_STATUS_OPTION,
  turnBackText,
  turnIntoText,
  type KbPageInfo,
} from '@carehub/extras/knowledge';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { verificationOf, type KnowledgeVerificationChanged } from './events';
import { createFakeKnowledge } from './fakes';
import { kbBases, kbPages, kbReports } from './schema';

const fake = createFakeKnowledge();

describe.skipIf(!hasDatabase)('turning pages into knowledge bases and back on Postgres', () => {
  let test: TestApp;
  /** Full access on the page, and the Create permission. */
  let avery: TestUser;
  /** Full access on the page, without the Create permission. */
  let sam: TestUser;
  /** Can edit, and writes some of the sub-pages. */
  let morgan: TestUser;
  /** Can view. */
  let riley: TestUser;
  const seen: KnowledgeVerificationChanged[] = [];
  let unbind: (() => void) | undefined;

  beforeAll(async () => {
    test = await createTestApp();
    const person = (name: string) =>
      createUser(test.db, {
        name,
        email: `${name.toLowerCase().replace(' ', '.')}@example.test`,
      });
    avery = await person('Avery Lin');
    sam = await person('Sam Ortiz');
    morgan = await person('Morgan Diaz');
    riley = await person('Riley Chen');
    fake.creators.add(avery.id);
    fake.creators.add(morgan.id);
    unbind = fake.bind();
    test.app.events.on('knowledge.verification.changed', (change) => {
      seen.push(change);
    });
  });
  afterAll(async () => {
    unbind?.();
    await test?.close();
  });

  const call = (user: TestUser, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  /** A page with `count` sub-pages, written in turn by Sam and Morgan. */
  function handbook(count: number) {
    const pageId = fake.newPage([
      [avery.id, 'full'],
      [sam.id, 'full'],
      [morgan.id, 'edit'],
      [riley.id, 'view'],
    ]);
    const subPages = Array.from({ length: count }, (_, i) =>
      fake.newPage([], { parentId: pageId, createdBy: (i % 2 ? morgan : sam).id }),
    );
    return { pageId, subPages };
  }
  const indexOf = async (pageId: string) =>
    (await test.db.select().from(kbPages).where(eq(kbPages.pageId, pageId)))[0];

  it('turns a page with 24 sub-pages into 24 published pages owned by their creators (KB-01)', async () => {
    const { pageId, subPages } = handbook(24);
    const gone = fake.newPage([], { parentId: pageId, createdBy: sam.id });
    fake.archived.add(gone);
    const url = `/api/knowledge/pages/${pageId}/turn-into`;

    const preview = await call(avery, 'GET', url);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toEqual({
      title: 'Support handbook',
      subPages: 24,
      text: turnIntoText('Support handbook', 24),
    });
    // Full access without the Create permission isn't enough, and Can edit isn't Full access.
    expect((await call(sam, 'GET', url)).statusCode).toBe(403);
    expect((await call(sam, 'POST', url)).statusCode).toBe(403);
    expect((await call(morgan, 'POST', url)).statusCode).toBe(403);
    expect((await call(riley, 'POST', url)).statusCode).toBe(403);

    const turned = await call(avery, 'POST', url);
    expect(turned.statusCode, turned.body).toBe(201);
    expect(turned.json()).toEqual({ databaseId: pageId, pages: 24 });
    for (const [i, id] of subPages.entries()) {
      const creator = (i % 2 ? morgan : sam).id;
      expect(fake.rows.get(id)?.values).toEqual({
        [KB_PROPERTY.owner]: [creator],
        [KB_PROPERTY.status]: KB_STATUS_OPTION.published,
        [KB_PROPERTY.verification]: null,
        [KB_PROPERTY.tags]: [],
      });
      expect(await indexOf(id)).toMatchObject({
        databaseId: pageId,
        status: 'published',
        publishedBy: avery.id,
        owners: [creator],
        verification: null,
      });
    }
    expect(fake.rows.has(gone)).toBe(false);
    const [base] = await test.db.select().from(kbBases).where(eq(kbBases.databaseId, pageId));
    expect(base).toMatchObject({ workspaceId: fake.workspaceId, defaultPeriod: '90d' });
    // Readers see the pages at once, at the same address.
    const asRiley = await call(riley, 'GET', `/api/knowledge/pages/${subPages[0]}`);
    expect(asRiley.statusCode).toBe(200);
    expect((asRiley.json() as KbPageInfo).status).toBe('published');

    expect((await call(avery, 'POST', url)).statusCode).toBe(409);
    expect(
      (await call(avery, 'POST', `/api/knowledge/pages/${subPages[0]}/turn-into`)).statusCode,
    ).toBe(409);
    expect(
      (await call(avery, 'GET', `/api/knowledge/pages/${randomUUID()}/turn-into`)).statusCode,
    ).toBe(404);
  });

  it('refuses pages with more than 5,000 sub-pages', async () => {
    const { pageId } = handbook(5001);
    const res = await call(avery, 'GET', `/api/knowledge/pages/${pageId}/turn-into`);
    expect(res.statusCode).toBe(413);
    expect((await call(avery, 'POST', `/api/knowledge/pages/${pageId}/turn-into`)).statusCode).toBe(
      413,
    );
    expect(fake.bases.has(pageId)).toBe(false);
  });

  it('turns it back after saying what goes, keeping drafts from readers (KB-02)', async () => {
    const { pageId, subPages } = handbook(3);
    const [draft, verified, plain] = subPages;
    if (!draft || !verified || !plain) throw new Error('The sub-pages were not made.');
    expect((await call(avery, 'POST', `/api/knowledge/pages/${pageId}/turn-into`)).statusCode).toBe(
      201,
    );
    expect(
      (await call(avery, 'PUT', `/api/knowledge/pages/${draft}/status`, { status: 'draft' }))
        .statusCode,
    ).toBe(200);
    const verify = await call(avery, 'POST', `/api/knowledge/pages/${verified}/verification`, {
      period: 'none',
    });
    expect(verify.statusCode, verify.body).toBe(200);
    await test.app.events.settled();
    expect(seen).toContainEqual({
      workspaceId: fake.workspaceId,
      pageId: verified,
      state: 'verified',
      until: null,
    });
    expect(await verificationOf(test.db, [verified, plain, randomUUID()])).toEqual(
      new Map([
        [verified, { state: 'verified', until: null }],
        [plain, { state: 'none', until: null }],
      ]),
    );
    const report = (status: 'new' | 'in_progress' | 'fixed') =>
      test.db.insert(kbReports).values({
        pageId: plain,
        databaseId: pageId,
        workspaceId: fake.workspaceId,
        reporterId: riley.id,
        reason: 'out_of_date',
        status,
        ...(status === 'fixed' ? { closedAt: new Date(), closedBy: avery.id } : {}),
      });
    await report('new');
    await report('in_progress');
    await report('fixed');
    const url = `/api/knowledge/bases/${pageId}/turn-back`;

    const preview = await call(avery, 'GET', url);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toEqual({ openReports: 2, text: turnBackText(2) });
    expect(turnBackText(2)).toBe(
      'Owner, status, verification, tags and 2 open reports will be removed.',
    );
    expect((await call(sam, 'POST', url)).statusCode).toBe(403);
    expect((await call(riley, 'GET', url)).statusCode).toBe(403);

    const back = await call(avery, 'POST', url);
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json()).toEqual({ pageId, pages: 3 });
    expect([...fake.keptForEditors]).toEqual([draft]);
    expect(fake.levels.get(draft)?.has(riley.id)).toBe(false);
    expect(fake.levels.get(plain)?.get(riley.id)).toBe('view');
    expect(fake.bases.has(pageId)).toBe(false);
    expect(await test.db.select().from(kbBases).where(eq(kbBases.databaseId, pageId))).toEqual([]);
    expect(await test.db.select().from(kbPages).where(eq(kbPages.databaseId, pageId))).toEqual([]);
    expect(await test.db.select().from(kbReports).where(eq(kbReports.databaseId, pageId))).toEqual(
      [],
    );
    await test.app.events.settled();
    expect(seen.at(-1)).toEqual({
      workspaceId: fake.workspaceId,
      pageId: verified,
      state: 'none',
      until: null,
    });
    expect((await call(avery, 'GET', `/api/knowledge/pages/${plain}`)).statusCode).toBe(404);
    expect((await call(avery, 'GET', url)).statusCode).toBe(404);
  });

  it('denies turning anything until the page model and Databases are bound', async () => {
    const { pageId } = handbook(1);
    unbind?.();
    try {
      expect(
        (await call(avery, 'GET', `/api/knowledge/pages/${pageId}/turn-into`)).statusCode,
      ).toBe(404);
    } finally {
      unbind = fake.bind();
    }
  });
});
