import { layerSchema, layersResponseSchema } from '@carehub/team-calendar-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';

describe.skipIf(!hasDatabase)('calendar layers', () => {
  let test: TestApp;
  let ada: TestUser;
  let ben: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    ada = await createUser(test.db, { name: 'Ada Example' });
    ben = await createUser(test.db, { name: 'Ben Sample', role: 'viewer' });
  });

  afterAll(async () => {
    await test?.close();
  });

  async function layersOf(user: TestUser) {
    const response = await injectAs(test.app, user, { method: 'GET', url: '/api/calendar/layers' });
    expect(response.statusCode, response.body).toBe(200);
    return layersResponseSchema.parse(response.json()).layers;
  }

  const change = (user: TestUser, layerId: string, payload: Record<string, unknown>) =>
    injectAs(test.app, user, { method: 'PATCH', url: `/api/calendar/layers/${layerId}`, payload });

  async function changed(user: TestUser, layerId: string, payload: Record<string, unknown>) {
    const response = await change(user, layerId, payload);
    expect(response.statusCode, response.body).toBe(200);
    return layerSchema.parse(response.json().layer);
  }

  const summary = (layers: readonly { id: string; color: string; on: boolean }[]) =>
    layers.map(({ id, color, on }) => ({ id, color, on }));

  it('starts with My events and Meetings, both on', async () => {
    expect(summary(await layersOf(ada))).toEqual([
      { id: 'my-events', color: 'blue', on: true },
      { id: 'meetings', color: 'purple', on: true },
    ]);
  });

  it("keeps a person's switches, colours and order, for that person only (CA-04)", async () => {
    expect(await changed(ada, 'meetings', { on: false, color: 'green' })).toMatchObject({
      id: 'meetings',
      name: 'Meetings',
      on: false,
      color: 'green',
    });
    await changed(ada, 'meetings', { order: 0 });
    await changed(ada, 'my-events', { order: 1 });
    expect(summary(await layersOf(ada))).toEqual([
      { id: 'meetings', color: 'green', on: false },
      { id: 'my-events', color: 'blue', on: true },
    ]);
    expect(summary(await layersOf(ben))).toEqual([
      { id: 'my-events', color: 'blue', on: true },
      { id: 'meetings', color: 'purple', on: true },
    ]);
  });

  it('refuses unknown layers and bad changes', async () => {
    expect((await change(ben, 'learning', { on: false })).statusCode).toBe(404);
    expect((await change(ben, 'someone-else', { on: false })).statusCode).toBe(404);
    for (const payload of [{}, { color: '#ff0000' }, { name: 'Mine' }, { order: -1 }]) {
      expect((await change(ben, 'meetings', payload)).statusCode).toBe(400);
    }
  });

  it('needs a signed-in member', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/api/calendar/layers' });
    expect(response.statusCode).toBe(401);
    const guest = await createUser(test.db, { kind: 'guest' });
    const asGuest = await injectAs(test.app, guest, { method: 'GET', url: '/api/calendar/layers' });
    expect(asGuest.statusCode).toBe(403);
  });
});
