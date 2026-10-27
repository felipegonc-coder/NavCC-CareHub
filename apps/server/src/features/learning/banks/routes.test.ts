import { randomUUID } from 'node:crypto';
import type { BankReply, QuestionBank } from '@carehub/learning';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import learningRoutes from '../routes';

// Core doesn't put the workspace member on requests yet (accounts 1b), so this app does it from the
// x-test-person header, the way core's sessions will. Fictional data only.
const workspaceId = randomUUID();
const PEOPLE = {
  trainer: {
    id: randomUUID(),
    workspaceId,
    roleId: 'role-trainer',
    permissions: ['learning.build'],
  },
  stranger: {
    id: randomUUID(),
    workspaceId: randomUUID(),
    roleId: 'role-trainer',
    permissions: ['learning.build'],
  },
  learner: { id: randomUUID(), workspaceId, roleId: 'role-viewer', permissions: [] },
};
type Person = keyof typeof PEOPLE;

const HEADER = 'Type,Question,Answer 1,Answer 2,Correct';

describe.skipIf(!hasDatabase)('Learning question banks API', () => {
  let server: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    server = await createTestApp();
    app = Fastify();
    app.decorate('db', server.db);
    app.decorateRequest('user', null);
    app.decorateRequest('member', null);
    app.addHook('onRequest', async (request) => {
      const person = PEOPLE[request.headers['x-test-person'] as Person];
      if (!person) return;
      const { id, workspaceId: inWorkspace, roleId, permissions } = person;
      Object.assign(request, {
        user: { id },
        member: { workspaceId: inWorkspace, roleId, permissions: new Set(permissions) },
      });
    });
    await app.register(learningRoutes, { prefix: '/api/learning' });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  const call = (
    person: Person | null,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: object,
  ) =>
    app.inject({
      method,
      url: `/api/learning${url}`,
      headers: person ? { 'x-test-person': person } : {},
      ...(body ? { payload: body } : {}),
    });

  it('lets in only people who build courses', async () => {
    expect((await call(null, 'GET', '/studio/banks')).statusCode).toBe(401);
    const learner = await call('learner', 'GET', '/studio/banks');
    expect(learner.statusCode).toBe(403);
    expect(learner.json()).toEqual({
      error: { code: 'forbidden', message: "You don't have access to this." },
    });
    expect((await call('learner', 'POST', '/studio/banks', { title: 'Mine' })).statusCode).toBe(
      403,
    );
  });

  it('creates, saves, imports into and deletes a bank, with the revision check', async () => {
    const created = await call('trainer', 'POST', '/studio/banks', { title: ' Escalations ' });
    expect(created.statusCode).toBe(201);
    const { bank, revision }: BankReply = created.json();
    expect(bank).toMatchObject({ title: 'Escalations', questions: [] });
    expect(revision).toBe(1);
    expect((await call('trainer', 'GET', '/studio/banks')).json()).toEqual([
      { id: bank.id, title: 'Escalations', questionCount: 0, updatedAt: expect.any(String) },
    ]);
    expect((await call('stranger', 'GET', '/studio/banks')).json()).toEqual([]);
    expect((await call('stranger', 'GET', `/studio/banks/${bank.id}`)).statusCode).toBe(404);

    const edited: QuestionBank = { ...bank, description: 'Who handles what.' };
    const saved = await call('trainer', 'PUT', `/studio/banks/${bank.id}`, {
      bank: edited,
      revision,
    });
    expect(saved.json()).toEqual({ revision: 2 });
    const stale = await call('trainer', 'PUT', `/studio/banks/${bank.id}`, { bank, revision });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'conflict' } });
    const invalid = await call('trainer', 'PUT', `/studio/banks/${bank.id}`, {
      bank: { ...edited, title: '' },
      revision: 2,
    });
    expect(invalid.statusCode).toBe(400);

    const imported = await call('trainer', 'POST', `/studio/banks/${bank.id}/import`, {
      csv: `${HEADER}\r\nSingle choice,Who handles refunds?,Repairs,Billing,2\r\nSingle choice,Nobody is right here,Repairs,Billing,`,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ added: 1, errors: [{ row: 3 }] });
    const reloaded: BankReply = (await call('trainer', 'GET', `/studio/banks/${bank.id}`)).json();
    expect(reloaded).toMatchObject({ revision: 3, bank: { description: 'Who handles what.' } });
    expect(reloaded.bank.questions).toHaveLength(1);

    expect((await call('stranger', 'DELETE', `/studio/banks/${bank.id}`)).statusCode).toBe(404);
    expect((await call('trainer', 'DELETE', `/studio/banks/${bank.id}`)).statusCode).toBe(204);
    expect((await call('trainer', 'GET', `/studio/banks/${bank.id}`)).statusCode).toBe(404);
  });

  it('takes spreadsheets over 1 MB, and refuses text over the import limit with a reason', async () => {
    const { bank }: BankReply = (
      await call('trainer', 'POST', '/studio/banks', { title: 'Big imports' })
    ).json();
    const long = await call('trainer', 'POST', `/studio/banks/${bank.id}/import`, {
      csv: `${HEADER}\r\nTrue or false,${'x'.repeat(1_500_000)},,,true`,
    });
    expect(long.statusCode).toBe(200);
    expect(long.json()).toMatchObject({ added: 0 });
    const tooBig = await call('trainer', 'POST', `/studio/banks/${bank.id}/import`, {
      csv: 'x'.repeat(2_000_001),
    });
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json()).toMatchObject({ error: { issues: [{ path: 'csv' }] } });
  });
});
