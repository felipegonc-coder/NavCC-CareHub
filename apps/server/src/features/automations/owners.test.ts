import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SendNoticeInput } from '../notices';
import { createMemoryAutomationStore } from './domain/memoryStore';
import type { NewAutomation } from './domain/types';
import { OWNER_LEFT, type Person } from './access';
import { createOwnerLeft } from './owners';

const workspaceId = randomUUID();
const avery: Person = { userId: randomUUID(), name: 'Avery Lin', roleId: 'admin', isAdmin: true };
const jordan: Person = { userId: randomUUID(), name: 'Jordan Wu', roleId: 'admin', isAdmin: true };
const riley: Person = { userId: randomUUID(), name: 'Riley Chen', roleId: 'agent', isAdmin: false };
const sam = randomUUID();
const nine = new Date('2026-10-27T15:00:00.000Z');

function automation(name: string, ownerUserId: string): NewAutomation {
  return {
    workspaceId,
    name,
    ownerUserId,
    enabled: true,
    trigger: {
      kind: 'schedule',
      schedule: { kind: 'weekdays', time: '09:00', timeZone: 'America/Denver', endDate: null },
    },
    conditions: null,
    variables: [],
    actions: [],
    nextRunAt: nine,
  };
}

async function setUp(...automations: NewAutomation[]) {
  const store = createMemoryAutomationStore();
  const notices: SendNoticeInput[] = [];
  const created = [];
  for (const input of automations) created.push(await store.create(input, nine));
  const ownerLeft = createOwnerLeft({
    store,
    people: async () => [avery, jordan, riley],
    sendNotice: async (input) => {
      notices.push(input);
    },
    now: () => nine,
  });
  return { store, notices, ownerLeft, ids: created.map((a) => a?.id ?? '') };
}

describe('when an owner leaves', () => {
  it('switches their automations off, says why, and tells each Admin', async () => {
    const { store, notices, ownerLeft, ids } = await setUp(
      automation('Weekday stand-up nudge', sam),
      automation('Friday wrap-up', avery.userId),
    );
    await ownerLeft({ workspaceId, userId: sam });

    const [standUp, wrapUp] = [
      await store.get(workspaceId, ids[0]!),
      await store.get(workspaceId, ids[1]!),
    ];
    expect(standUp).toMatchObject({ enabled: false, nextRunAt: null, pausedReason: OWNER_LEFT });
    expect(wrapUp).toMatchObject({ enabled: true, pausedReason: null });
    expect(notices).toEqual(
      [avery, jordan].map((admin) => ({
        workspaceId,
        userId: admin.userId,
        kind: 'automation',
        sender: 'Automation: Weekday stand-up nudge',
        title: 'An automation was switched off',
        text: 'Its owner left the workspace. Switch it back on to become its owner.',
        buttons: [{ label: 'Open it', href: `/settings/automations/${ids[0]}` }],
      })),
    );
  });

  it('sends each Admin one notice for several automations', async () => {
    const { notices, ownerLeft } = await setUp(
      automation('Weekday stand-up nudge', sam),
      automation('Monthly QA digest', sam),
    );
    await ownerLeft({ workspaceId, userId: sam });

    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({
      userId: avery.userId,
      sender: 'Automations',
      title: '2 automations were switched off',
      buttons: [{ label: 'See automations', href: '/settings/automations' }],
    });
  });

  it('does nothing when they owned none that were on', async () => {
    const off = { ...automation('Weekday stand-up nudge', sam), enabled: false };
    const { notices, ownerLeft } = await setUp(off);
    await ownerLeft({ workspaceId, userId: sam });

    expect(notices).toEqual([]);
  });
});
