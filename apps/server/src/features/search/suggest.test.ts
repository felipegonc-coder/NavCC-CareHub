import { randomUUID } from 'node:crypto';
import type { SearchPerson, SearchResponse } from '@carehub/extras/search';
import type { AccessLevel } from '@carehub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { reindexForSearch } from './index';
import { bindSearchMember, bindSearchPages, type IndexPage } from './pages';

const pages = new Map<string, IndexPage>();
const levels = new Map<string, Map<string, AccessLevel>>();

describe.skipIf(!hasDatabase)('Did you mean and the people chips on Postgres', () => {
  let test: TestApp;
  let val: TestUser;
  let eli: TestUser;
  let riley: TestUser;
  let workspaceId = randomUUID();
  let clock = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    val = await createUser(test.db, { name: 'Val Moreno', email: 'val.moreno@example.test' });
    eli = await createUser(test.db, { name: 'Eli Brooks', email: 'eli.brooks@example.test' });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    unbind.push(
      bindSearchPages({
        getPagesForIndex: async (_db, ids) =>
          new Map(ids.flatMap((id) => (pages.has(id) ? [[id, pages.get(id)!] as const] : []))),
        getAccessForPages: async (_db, userId, ids) =>
          new Map(ids.map((id) => [id, levels.get(id)?.get(userId) ?? 'none'])),
      }),
      // Riley isn't in the workspace.
      bindSearchMember((request) =>
        request.user && request.user.id !== riley.id ? { workspaceId, isGuest: false } : null,
      ),
    );
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });
  beforeEach(() => {
    workspaceId = randomUUID();
  });

  async function addPage(
    title: string,
    open: TestUser[] = [val, eli],
    fields: Partial<IndexPage> = {},
  ) {
    const id = randomUUID();
    clock += 60_000;
    pages.set(id, {
      id,
      workspaceId,
      spaceId: null,
      parentId: null,
      ancestorIds: [],
      kind: 'page',
      title,
      icon: null,
      createdBy: eli.id,
      createdAt: new Date(clock),
      updatedBy: eli.id,
      updatedAt: new Date(clock),
      archivedAt: null,
      trashed: false,
      ...fields,
    });
    levels.set(id, new Map(open.map((user) => [user.id, 'view'])));
    await reindexForSearch(test.db, [id]);
    return id;
  }
  async function search(user: TestUser, payload: object) {
    const response = await injectAs(test.app, user, {
      method: 'POST',
      url: '/api/search/query',
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<SearchResponse>();
  }
  async function people(user: TestUser, query: string) {
    const response = await injectAs(test.app, user, {
      method: 'GET',
      url: `/api/search/people?${query}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ people: SearchPerson[] }>().people.map((person) => person.name);
  }

  it('offers a title one or two letters off when fewer than 3 are found (SR-11)', async () => {
    await addPage('Refund steps');
    await addPage('Holiday rota');
    expect(await search(val, { text: 'refnd' })).toMatchObject({ total: 0, didYouMean: 'refund' });
    expect(await search(val, { text: 'holdiay rota' })).toMatchObject({
      didYouMean: 'holiday rota',
    });
    const found = await search(val, { text: 'refund' });
    expect(found.total).toBe(1);
    expect(found).not.toHaveProperty('didYouMean');
    expect(await search(val, { text: 'qzxv' })).not.toHaveProperty('didYouMean');
  });

  it('only offers titles the person can open, outside Trash', async () => {
    await addPage('Payroll figures', [eli]);
    await addPage('Onboarding plan', [val, eli], { trashed: true });
    expect(await search(eli, { text: 'payrill' })).toMatchObject({ didYouMean: 'payroll' });
    expect(await search(val, { text: 'payrill' })).not.toHaveProperty('didYouMean');
    expect(await search(val, { text: 'onbaording' })).not.toHaveProperty('didYouMean');
  });

  it('offers archived titles only with Include archived', async () => {
    await addPage('Escalation guide', [val], { archivedAt: new Date() });
    expect(await search(val, { text: 'escalaton' })).not.toHaveProperty('didYouMean');
    expect(
      await search(val, { text: 'escalaton', filters: { includeArchived: true } }),
    ).toMatchObject({ didYouMean: 'escalation' });
  });

  it('leaves it out with 3 results or more, on later pages, in pickers and for any word', async () => {
    for (const n of [1, 2, 3]) await addPage(`Refund note ${n}`);
    await addPage('Refund steps');
    // 4 results, so no Did you mean, though "refnd" is a letter off.
    expect(await search(val, { text: 'refund OR refnd' })).not.toHaveProperty('didYouMean');
    expect(await search(val, { text: 'refnd' })).toMatchObject({ didYouMean: 'refund' });
    expect(await search(val, { text: 'refnd', limit: 5 })).not.toHaveProperty('didYouMean');
    expect(await search(val, { text: 'refnd', cursor: '20' })).not.toHaveProperty('didYouMean');
    expect(await search(val, { text: 'refnd', match: 'any' })).not.toHaveProperty('didYouMean');
  });

  it('lists who created or last edited pages the person can open, most pages first', async () => {
    await addPage('Rota', [val, eli], { createdBy: val.id, updatedBy: eli.id });
    await addPage('Refunds', [val, eli], { createdBy: eli.id, updatedBy: val.id });
    await addPage('Handover', [val, eli], { createdBy: eli.id, updatedBy: eli.id });
    // Riley made a page only Eli can open, so Val isn't offered Riley.
    await addPage('Pay bands', [eli], { createdBy: riley.id, updatedBy: riley.id });
    expect(await people(val, 'role=created')).toEqual(['Eli Brooks', 'Val Moreno']);
    expect(await people(val, 'role=edited')).toEqual(['Eli Brooks', 'Val Moreno']);
    expect(await people(eli, 'role=created')).toEqual(['Eli Brooks', 'Riley Chen', 'Val Moreno']);
    // The start of the name or of any word in it, accents and case ignored.
    expect(await people(val, 'role=created&q=BRO')).toEqual(['Eli Brooks']);
    expect(await people(val, 'role=created&q=val%20mor')).toEqual(['Val Moreno']);
    expect(await people(val, 'role=created&q=riley')).toEqual([]);
  });

  it('needs a member of the workspace and a role', async () => {
    const outsider = await injectAs(test.app, riley, {
      method: 'GET',
      url: '/api/search/people?role=created',
    });
    expect(outsider.statusCode).toBe(403);
    const invalid = await injectAs(test.app, val, {
      method: 'GET',
      url: '/api/search/people?role=owner',
    });
    expect(invalid.statusCode).toBe(400);
    const signedOut = await test.app.inject({
      method: 'GET',
      url: '/api/search/people?role=edited',
    });
    expect(signedOut.statusCode).toBe(401);
  });
});
