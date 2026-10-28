import { hasPermission, type CurrentUser, type PermissionKey } from '@carehub/shared';
import type { AutomationView } from '@carehub/team-automations/api';
import { MAX_AUTOMATIONS, type Action, type Trigger } from '@carehub/team-automations/automation';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler, httpError } from '../../core/errors';
import type { CurrentMember } from '../workspaces';
import { createMemoryAutomationStore } from './domain/memoryStore';
import type { AutomationStore } from './domain/types';
import automationsRoutes from './routes';

const workspaceId = '3b9f0d52-6c1e-4f7a-9d3e-2a1b4c5d6e7f';
const otherWorkspaceId = '8e2d4c6b-1a3f-4b5d-8c7e-9f0a1b2c3d4e';
const ids = {
  avery: '7f0c2b9e-3d4a-4c1e-9b8f-1a2b3c4d5e6f',
  eli: '4d6f8a0c-2e4a-4c6e-8a0c-2e4a6c8e0a2c',
  kai: '6b8d0f2a-4c6e-4a8b-9d1f-3e5a7c9b1d3f',
  riley: '5a7c9e1b-3d5f-4a7c-8e9a-1b3d5f7a9c1e',
  sam: '2c4e6a8b-0d1f-4e3a-9b5c-7d9e1f3a5b7c',
};
// Who is asking: the test hooks read these headers.
const avery = { 'x-test-user': ids.avery, 'x-test-role': 'admin' };
const eli = { 'x-test-user': ids.eli, 'x-test-role': 'editor' };
const kai = { 'x-test-user': ids.kai, 'x-test-role': 'guest' };
// Signed in, but not in the workspace.
const riley = { 'x-test-user': ids.riley };
const sam = {
  'x-test-user': ids.sam,
  'x-test-role': 'admin',
  'x-test-workspace': otherWorkspaceId,
};

// Tuesday, Oct 27, 2026, at 8:00 AM in Denver.
const now = new Date('2026-10-27T14:00:00.000Z');
const weekdays: Trigger = {
  kind: 'schedule',
  schedule: { kind: 'weekdays', time: '09:00', timeZone: 'America/Denver', endDate: null },
};
const rowAdded: Trigger = { kind: 'rowAdded', databaseId: 'db-qa-reviews', includeImports: false };
const message: Action = {
  kind: 'sendMessage',
  recipients: [{ kind: 'everyone' }],
  text: 'Good morning, {first name}. Stand-up is at 9:15.',
  pageIds: [],
};
const standUp = { name: 'Stand-up reminder', trigger: weekdays, actions: [message] };

let app: FastifyInstance | undefined;
let store: AutomationStore;

function testUser(id: string): CurrentUser {
  return {
    id,
    email: `${id}@example.test`,
    name: 'Test person',
    avatarUrl: null,
    isSiteAdmin: false,
    timeZone: 'America/Denver',
    use24h: false,
    weekStart: 0,
    mustChangePassword: false,
  };
}

function testMember(role: string, workspace: string): CurrentMember {
  if (role === 'guest') {
    const permissions = new Set<PermissionKey>();
    return {
      kind: 'guest',
      workspaceId: workspace,
      roleId: null,
      roleName: null,
      permissions,
      isAdmin: false,
    };
  }
  const isAdmin = role === 'admin';
  const permissions = new Set<PermissionKey>(
    isAdmin ? ['pages.edit', 'workspace.admin'] : ['pages.edit'],
  );
  return {
    kind: 'member',
    workspaceId: workspace,
    roleId: `role-${role}`,
    roleName: role,
    permissions,
    isAdmin,
  };
}

const header = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

async function build(): Promise<FastifyInstance> {
  store = createMemoryAutomationStore();
  app = Fastify();
  app.setErrorHandler(errorHandler);
  app.decorateRequest('user', null);
  app.decorateRequest('member', null);
  // Stands in for the auth plugin's guard: 401 signed out, then 403 for people outside the
  // workspace, guests and roles without the key.
  app.decorate('requirePermission', (key: PermissionKey) => async (request: FastifyRequest) => {
    if (!request.user) throw httpError(401, 'signed_out');
    if (!hasPermission(request.member, key)) throw httpError(403, 'forbidden');
  });
  app.addHook('onRequest', async (request) => {
    const id = header(request.headers['x-test-user']);
    const role = header(request.headers['x-test-role']);
    const workspace = header(request.headers['x-test-workspace']) ?? workspaceId;
    request.user = id ? testUser(id) : null;
    request.member = id && role ? testMember(role, workspace) : null;
  });
  await app.register(automationsRoutes, { prefix: '/api/automations', store, now: () => now });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface Call {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  payload?: object;
}
const call = (options: Call) => app!.inject(options);

async function create(body: object = standUp): Promise<AutomationView> {
  const response = await call({
    method: 'POST',
    url: '/api/automations',
    headers: avery,
    payload: body,
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { automation: AutomationView }).automation;
}

describe('/api/automations for an Admin', () => {
  it('creates, reads, changes and deletes an automation', async () => {
    await build();
    const created = await create();
    expect(created).toMatchObject({
      name: 'Stand-up reminder',
      ownerUserId: ids.avery,
      enabled: true,
      trigger: weekdays,
      conditions: null,
      variables: [],
      actions: [message],
      nextRunAt: '2026-10-27T15:00:00.000Z',
      pausedReason: null,
      lastRun: null,
      createdAt: '2026-10-27T14:00:00.000Z',
    });
    expect(created).not.toHaveProperty('workspaceId');
    const url = `/api/automations/${created.id}`;

    const list = await call({ method: 'GET', url: '/api/automations', headers: avery });
    expect(list.json()).toEqual({ automations: [created] });
    expect((await call({ method: 'GET', url, headers: avery })).json()).toEqual({
      automation: created,
    });

    const patched = await call({
      method: 'PATCH',
      url,
      headers: avery,
      payload: { name: 'Morning stand-up', enabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual({
      automation: { ...created, name: 'Morning stand-up', enabled: false, nextRunAt: null },
    });

    const removed = await call({ method: 'DELETE', url, headers: avery });
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');
    const gone = await call({ method: 'GET', url, headers: avery });
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({
      error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
    });
  });

  it('shows the run history newest first, without the run keys', async () => {
    await build();
    const created = await create();
    const started = await store.startRun({
      automationId: created.id,
      kind: 'scheduled',
      key: 'scheduled:2026-10-27T15:00:00.000Z',
      plannedFor: new Date('2026-10-27T15:00:00.000Z'),
      source: null,
      startedBy: null,
      now: new Date('2026-10-27T15:00:02.000Z'),
    });
    const steps = [
      { action: 0, kind: 'sendMessage' as const, result: 'done' as const, message: null },
    ];
    await store.finishRun(
      started!.run.id,
      { result: 'sent', steps, recipients: 12, error: null },
      new Date('2026-10-27T15:00:05.000Z'),
    );
    await store.startRun({
      automationId: created.id,
      kind: 'test',
      key: null,
      plannedFor: null,
      source: null,
      startedBy: ids.avery,
      now: new Date('2026-10-27T15:10:00.000Z'),
    });

    const response = await call({
      method: 'GET',
      url: `/api/automations/${created.id}/runs`,
      headers: avery,
    });
    expect(response.statusCode).toBe(200);
    const { runs } = response.json() as { runs: unknown[] };
    expect(runs).toMatchObject([
      { kind: 'test', startedBy: ids.avery, result: null, createdAt: '2026-10-27T15:10:00.000Z' },
      {
        kind: 'scheduled',
        plannedFor: '2026-10-27T15:00:00.000Z',
        ranAt: '2026-10-27T15:00:02.000Z',
        finishedAt: '2026-10-27T15:00:05.000Z',
        result: 'sent',
        steps,
        recipients: 12,
        error: null,
        source: null,
      },
    ]);
    expect(runs[1]).not.toHaveProperty('key');
    // The list shows the last real run; tests don't count.
    const list = await call({ method: 'GET', url: '/api/automations', headers: avery });
    expect(list.json()).toMatchObject({
      automations: [{ lastRun: { result: 'sent', at: '2026-10-27T15:00:05.000Z' } }],
    });
  });

  it('filters the list by database and by on or off', async () => {
    await build();
    const qa = await create({ ...standUp, name: 'QA review added', trigger: rowAdded });
    const handover = await create({ ...standUp, name: 'Handover', enabled: false });
    const names = async (query: string) => {
      const response = await call({
        method: 'GET',
        url: `/api/automations${query}`,
        headers: avery,
      });
      return (response.json() as { automations: AutomationView[] }).automations.map((a) => a.name);
    };
    expect(await names('')).toEqual([handover.name, qa.name]);
    expect(await names('?databaseId=db-qa-reviews')).toEqual([qa.name]);
    expect(await names('?enabled=false')).toEqual([handover.name]);
    expect(await names(`?ownerUserId=${ids.avery}&enabled=true`)).toEqual([qa.name]);
  });
});

describe('/api/automations errors', () => {
  it('is for Admins only', async () => {
    await build();
    const created = await create();
    const url = `/api/automations/${created.id}`;
    const requests: Call[] = [
      { method: 'GET', url: '/api/automations' },
      { method: 'POST', url: '/api/automations', payload: standUp },
      { method: 'GET', url },
      { method: 'PATCH', url, payload: { name: 'Mine now' } },
      { method: 'DELETE', url },
      { method: 'GET', url: `${url}/runs` },
    ];
    for (const request of requests) {
      const signedOut = await call(request);
      expect(signedOut.statusCode).toBe(401);
      expect(signedOut.json()).toMatchObject({ error: { code: 'signed_out' } });
      for (const headers of [eli, kai, riley]) {
        const refused = await call({ ...request, headers });
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toEqual({
          error: { code: 'forbidden', message: "You don't have access to this." },
        });
      }
    }
    expect(await store.list(workspaceId)).toMatchObject([{ id: created.id, name: standUp.name }]);
  });

  it("answers 404 for another workspace's automation", async () => {
    await build();
    const created = await create();
    const url = `/api/automations/${created.id}`;
    for (const request of [
      { method: 'GET', url },
      { method: 'PATCH', url, payload: { name: 'Mine now' } },
      { method: 'DELETE', url },
      { method: 'GET', url: `${url}/runs` },
    ] satisfies Call[]) {
      expect((await call({ ...request, headers: sam })).statusCode).toBe(404);
    }
    const list = await call({ method: 'GET', url: '/api/automations', headers: sam });
    expect(list.json()).toEqual({ automations: [] });
    expect((await call({ method: 'GET', url, headers: avery })).json()).toEqual({
      automation: created,
    });
  });

  it('answers 400 with the field of each problem', async () => {
    await build();
    const noOne = await call({
      method: 'POST',
      url: '/api/automations',
      headers: avery,
      payload: { ...standUp, actions: [{ ...message, recipients: [] }] },
    });
    expect(noOne.statusCode).toBe(400);
    expect(noOne.json()).toEqual({
      error: {
        code: 'invalid',
        message: 'Pick at least one recipient.',
        details: [
          {
            code: 'custom',
            path: ['actions', 0, 'recipients'],
            message: 'Pick at least one recipient.',
          },
        ],
      },
    });
    const unnamed = await call({
      method: 'POST',
      url: '/api/automations',
      headers: avery,
      payload: { ...standUp, name: '   ' },
    });
    expect(unnamed.statusCode).toBe(400);
    expect(unnamed.json()).toMatchObject({
      error: { code: 'invalid', message: 'Give it a name.', details: [{ path: ['name'] }] },
    });
    const badFilter = await call({
      method: 'GET',
      url: '/api/automations?enabled=maybe',
      headers: avery,
    });
    expect(badFilter.statusCode).toBe(400);
    expect(badFilter.json()).toMatchObject({ error: { code: 'invalid' } });

    const created = await create();
    const noActions = await call({
      method: 'PATCH',
      url: `/api/automations/${created.id}`,
      headers: avery,
      payload: { actions: [] },
    });
    expect(noActions.statusCode).toBe(400);
    expect(noActions.json()).toMatchObject({
      error: { code: 'invalid', message: 'Add at least one action.' },
    });
  });

  it(`answers 413 past ${MAX_AUTOMATIONS} automations`, async () => {
    await build();
    for (let i = 1; i <= MAX_AUTOMATIONS; i += 1)
      await create({ ...standUp, name: `Reminder ${i}` });
    const response = await call({
      method: 'POST',
      url: '/api/automations',
      headers: avery,
      payload: standUp,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: {
        code: 'too_large',
        message: 'A workspace can have up to 50 automations. Delete one to add another.',
      },
    });
  });
});
