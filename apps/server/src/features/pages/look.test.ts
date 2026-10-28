// A page's look for History on a real database: read for a version, put back on restore (HT-05).
// Fictional people only.
import type { PageJson } from '@carehub/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { createPage, getPageLook, setPageLook } from './pages';

let app: Awaited<ReturnType<typeof createTestApp>>['app'];
let db: Db;
let close: () => Promise<void>;
let eli: TestUser;

describe.skipIf(!hasDatabase)('page look', () => {
  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    eli = await createUser(db, { role: 'editor', name: 'Eli Editor' });
  });
  afterAll(() => close());

  it('reads the look and puts it back as one change, with defaults for what it leaves out', async () => {
    const workspaceId = eli.workspaceId!;
    const page = await createPage(db, {
      workspaceId,
      kind: 'page',
      title: 'Menu',
      createdBy: eli.id,
    });
    const url = `/api/pages/${page.id}`;
    const patch = (payload: object) => injectAs(app, eli, { method: 'PATCH', url, payload });
    const icon = { type: 'emoji', emoji: '🍲' };
    await patch({ icon, font: 'serif', fullWidth: true, coverPosition: 20 });
    const saved = (await getPageLook(db, page.id))!;
    expect(saved).toMatchObject({
      title: 'Menu',
      icon,
      cover: null,
      style: { font: 'serif', fullWidth: true, coverPosition: 20 },
    });

    await patch({
      title: 'Lunch menu',
      icon: null,
      font: 'mono',
      smallText: true,
      fullWidth: false,
    });
    await setPageLook(db, page.id, saved, eli.id);
    const back = (await injectAs(app, eli, { method: 'GET', url })).json() as PageJson;
    expect(back).toMatchObject({
      title: 'Menu',
      icon,
      font: 'serif',
      smallText: false,
      fullWidth: true,
      coverPosition: 20,
      updatedBy: { id: eli.id },
    });

    await setPageLook(db, page.id, { title: 'Menu', icon: null, cover: null, style: {} }, eli.id);
    expect((await getPageLook(db, page.id))?.style).toEqual({
      font: 'default',
      smallText: false,
      textDirection: 'ltr',
      fullWidth: false,
      coverPosition: 50,
    });
    const wrong = { ...saved, style: { font: 'comic' } };
    await expect(setPageLook(db, page.id, wrong, eli.id)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await getPageLook(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
