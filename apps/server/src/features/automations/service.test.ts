import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { MAX_AUTOMATIONS, type Action, type Trigger } from '@carehub/team-automations/automation';
import { createMemoryAutomationStore } from './domain/memoryStore';
import { OWNER_LEFT } from './owners';
import { createAutomationsService, nextRunFor, type Caller } from './service';

const workspaceId = '3b9f0d52-6c1e-4f7a-9d3e-2a1b4c5d6e7f';
const avery: Caller = { workspaceId, userId: '7f0c2b9e-3d4a-4c1e-9b8f-1a2b3c4d5e6f' };
const riley: Caller = { workspaceId, userId: '5a7c9e1b-3d5f-4a7c-8e9a-1b3d5f7a9c1e' };
// An Admin of another workspace.
const sam: Caller = {
  workspaceId: '8e2d4c6b-1a3f-4b5d-8c7e-9f0a1b2c3d4e',
  userId: '2c4e6a8b-0d1f-4e3a-9b5c-7d9e1f3a5b7c',
};

// Tuesday, Oct 27, 2026, at 8:00 AM in Denver.
const tuesday8am = new Date('2026-10-27T14:00:00.000Z');
const at = (time: string) => new Date(`2026-10-27T${time}:00.000Z`);
const weekdaysAt = (time: string): Trigger => ({
  kind: 'schedule',
  schedule: { kind: 'weekdays', time, timeZone: 'America/Denver', endDate: null },
});
const rowAdded: Trigger = { kind: 'rowAdded', databaseId: 'db-qa-reviews', includeImports: false };
const message: Action = {
  kind: 'sendMessage',
  recipients: [{ kind: 'everyone' }],
  text: 'Good morning, {first name}. Stand-up is at 9:15.',
  pageIds: [],
};
const standUp = { name: 'Stand-up reminder', trigger: weekdaysAt('09:00'), actions: [message] };

function setup() {
  const clock = { now: tuesday8am };
  const store = createMemoryAutomationStore();
  const service = createAutomationsService({ store, now: () => clock.now });
  return { clock, store, service };
}

describe('create', () => {
  it('makes the caller the owner and plans the next run', async () => {
    const { service } = setup();
    const created = await service.create(avery, { ...standUp, name: '  Stand-up reminder ' });
    expect(created).toMatchObject({
      workspaceId,
      name: 'Stand-up reminder',
      ownerUserId: avery.userId,
      enabled: true,
      conditions: null,
      variables: [],
      nextRunAt: at('15:00'),
      pausedReason: null,
      lastRun: null,
    });
    expect(await service.get(avery, created.id)).toEqual(created);
  });

  it('plans no run for a database trigger, or for one that is off', async () => {
    const { service } = setup();
    const onRowAdded = await service.create(avery, { ...standUp, trigger: rowAdded });
    const off = await service.create(avery, { ...standUp, enabled: false });
    expect([onRowAdded.nextRunAt, off.nextRunAt]).toEqual([null, null]);
  });

  it('refuses a save with problems, naming the field of each', async () => {
    const { service } = setup();
    const noOne = { ...message, recipients: [] };
    await expect(service.create(avery, { ...standUp, actions: [noOne] })).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid',
      message: 'Pick at least one recipient.',
      details: [
        {
          code: 'custom',
          path: ['actions', 0, 'recipients'],
          message: 'Pick at least one recipient.',
        },
      ],
    });
    await expect(service.create(avery, { ...standUp, actions: [] })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(await service.list(avery, {})).toEqual([]);
  });

  it(`stops at ${MAX_AUTOMATIONS} automations in a workspace`, async () => {
    const { service } = setup();
    for (let i = 1; i <= MAX_AUTOMATIONS; i += 1) {
      await service.create(avery, { ...standUp, name: `Reminder ${i}` });
    }
    await expect(service.create(avery, standUp)).rejects.toMatchObject({
      statusCode: 413,
      code: 'too_large',
      message: 'A workspace can have up to 50 automations. Delete one to add another.',
    });
    expect(await service.create(sam, standUp)).toMatchObject({ workspaceId: sam.workspaceId });
  });
});

describe('update', () => {
  it('changes only the fields sent', async () => {
    const { clock, service } = setup();
    const created = await service.create(avery, standUp);
    clock.now = at('14:30');
    const renamed = await service.update(avery, created.id, { name: 'Morning stand-up' });
    expect(renamed).toEqual({ ...created, name: 'Morning stand-up', updatedAt: at('14:30') });
  });

  it('clears the next run when switched off, and plans it again when switched on', async () => {
    const { store, service } = setup();
    const created = await service.create(avery, standUp);
    // The server paused it.
    const reason = "Sam Ortiz can't open the Stand-up notes page anymore.";
    await store.update(
      workspaceId,
      created.id,
      { enabled: false, nextRunAt: null, pausedReason: reason },
      tuesday8am,
    );
    const back = await service.update(avery, created.id, { enabled: true });
    expect(back).toMatchObject({ enabled: true, nextRunAt: at('15:00'), pausedReason: null });
    const off = await service.update(avery, created.id, { enabled: false });
    expect(off).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it('makes the Admin who switches it back on its owner when its owner left', async () => {
    const { store, service } = setup();
    const created = await service.create(riley, standUp);
    const patch = { enabled: false, nextRunAt: null, pausedReason: OWNER_LEFT };
    await store.update(workspaceId, created.id, patch, tuesday8am);
    const back = await service.update(avery, created.id, { enabled: true });
    expect(back).toMatchObject({ enabled: true, ownerUserId: avery.userId, pausedReason: null });
  });

  it('plans the next run 15 minutes after the last scheduled run, but not after a manual one', async () => {
    const { clock, store, service } = setup();
    const scheduled = await service.create(avery, standUp);
    const manual = await service.create(avery, { ...standUp, name: 'Shift handover' });
    // Today's 9:00 AM run started 5 minutes late; the other one was sent by hand at 9:05.
    for (const [automation, kind] of [
      [scheduled, 'scheduled'],
      [manual, 'manual'],
    ] as const) {
      await store.startRun({
        automationId: automation.id,
        kind,
        key: kind === 'scheduled' ? 'scheduled:2026-10-27T15:00:00.000Z' : null,
        plannedFor: kind === 'scheduled' ? at('15:00') : null,
        source: null,
        startedBy: kind === 'manual' ? avery.userId : null,
        now: at('15:05'),
      });
    }
    clock.now = at('15:06');
    const nineFifteen = { trigger: weekdaysAt('09:15') };
    // 9:15 AM today is only 10 minutes after the late run, so it waits for tomorrow.
    expect((await service.update(avery, scheduled.id, nineFifteen)).nextRunAt).toEqual(
      new Date('2026-10-28T15:15:00.000Z'),
    );
    expect((await service.update(avery, manual.id, nineFifteen)).nextRunAt).toEqual(at('15:15'));
  });

  it('checks the automation as it would be after the change', async () => {
    const { service } = setup();
    const created = await service.create(avery, {
      ...standUp,
      trigger: rowAdded,
      conditions: { property: 'team', is: 'Phoenix' },
    });
    await expect(
      service.update(avery, created.id, { trigger: weekdaysAt('09:00') }),
    ).rejects.toMatchObject({
      statusCode: 400,
      details: [{ path: ['conditions'], message: 'Conditions need a database trigger.' }],
    });
    expect(await service.get(avery, created.id)).toEqual(created);
  });
});

describe('list', () => {
  it('filters by database, owner, and on or off', async () => {
    const { service } = setup();
    const qa = await service.create(avery, {
      ...standUp,
      name: 'QA review added',
      trigger: rowAdded,
    });
    const handover = await service.create(riley, { ...standUp, name: 'Handover', enabled: false });
    const names = async (query: unknown) =>
      (await service.list(avery, query)).map((automation) => automation.name);
    expect(await names(undefined)).toEqual([handover.name, qa.name]);
    expect(await names({ databaseId: 'db-qa-reviews' })).toEqual([qa.name]);
    expect(await names({ ownerUserId: riley.userId })).toEqual([handover.name]);
    expect(await names({ enabled: 'false' })).toEqual([handover.name]);
    expect(await names({ enabled: 'true' })).toEqual([qa.name]);
    await expect(service.list(avery, { ownerUserId: 'riley' })).rejects.toBeInstanceOf(ZodError);
  });
});

describe('another workspace', () => {
  it("can't see, change or delete this workspace's automations", async () => {
    const { service } = setup();
    const created = await service.create(avery, standUp);
    const notFound = { statusCode: 404, code: 'not_found' };
    await expect(service.get(sam, created.id)).rejects.toMatchObject(notFound);
    await expect(service.update(sam, created.id, { name: 'Mine now' })).rejects.toMatchObject(
      notFound,
    );
    await expect(service.remove(sam, created.id)).rejects.toMatchObject(notFound);
    await expect(service.runs(sam, created.id)).rejects.toMatchObject(notFound);
    expect(await service.list(sam, {})).toEqual([]);
    expect(await service.get(avery, created.id)).toEqual(created);
  });
});

describe('remove and runs', () => {
  it('lists the runs, and deletes the automation with them', async () => {
    const { store, service } = setup();
    const created = await service.create(avery, standUp);
    await store.startRun({
      automationId: created.id,
      kind: 'test',
      key: null,
      plannedFor: null,
      source: null,
      startedBy: avery.userId,
      now: at('14:10'),
    });
    expect(await service.runs(avery, created.id)).toMatchObject([
      { kind: 'test', startedBy: avery.userId, result: null },
    ]);
    await service.remove(avery, created.id);
    await expect(service.get(avery, created.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.remove(avery, created.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await store.listRuns(workspaceId, created.id)).toEqual([]);
  });
});

describe('nextRunFor', () => {
  it('plans runs only for scheduled automations that are on', () => {
    const trigger = weekdaysAt('09:00');
    expect(nextRunFor({ enabled: true, trigger }, tuesday8am, null)).toEqual(at('15:00'));
    expect(nextRunFor({ enabled: false, trigger }, tuesday8am, null)).toBeNull();
    expect(nextRunFor({ enabled: true, trigger: rowAdded }, tuesday8am, null)).toBeNull();
  });
});
