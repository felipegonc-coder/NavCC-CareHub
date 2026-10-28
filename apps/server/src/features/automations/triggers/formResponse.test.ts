import { randomUUID } from 'node:crypto';
import type { Trigger } from '@carehub/team-automations/automation';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryAutomationStore } from '../domain/memoryStore';
import type { AutomationStore } from '../domain/types';
import type { FormAnswer } from './databases';
import { handleFormAnswer } from './formResponse';
import type { QueueRun, TriggeredRun } from './runner';

const workspaceId = randomUUID();
const ownerUserId = randomUUID();
const riley = randomUUID();
const intake = randomUUID();
const intakeForm = randomUUID();
const feedbackForm = randomUUID();
const now = new Date('2026-10-28T15:00:00Z');

let store: AutomationStore;
let queued: { name: string; run: TriggeredRun }[];
const queueRun: QueueRun = async (automation, run) => {
  queued.push({ name: automation.name, run });
  return { jobId: randomUUID(), created: true };
};

async function add(name: string, trigger: Trigger, enabled = true) {
  await store.create(
    {
      workspaceId,
      name,
      ownerUserId,
      enabled,
      trigger,
      conditions: null,
      variables: [],
      actions: [
        { kind: 'sendMessage', recipients: [{ kind: 'everyone' }], text: 'Hi', pageIds: [] },
      ],
      nextRunAt: null,
    },
    now,
  );
}

const answer = (changes: Partial<FormAnswer> = {}): FormAnswer => ({
  workspaceId,
  databaseId: intake,
  formId: intakeForm,
  rowId: 'row-1',
  responseId: 'response-1',
  respondentId: riley,
  ...changes,
});

beforeEach(async () => {
  store = createMemoryAutomationStore();
  queued = [];
  await add('Intake follow-up', { kind: 'formResponse', databaseId: intake, formId: intakeForm });
  await add('Feedback thanks', { kind: 'formResponse', databaseId: intake, formId: feedbackForm });
  await add('New intake row', { kind: 'rowAdded', databaseId: intake, includeImports: false });
  await add(
    'Paused intake',
    { kind: 'formResponse', databaseId: intake, formId: intakeForm },
    false,
  );
});

describe('handleFormAnswer', () => {
  it('queues one run for each switched-on automation watching the form (AU-14)', async () => {
    expect(await handleFormAnswer({ store, queueRun }, answer())).toBe(1);
    expect(queued).toEqual([
      {
        name: 'Intake follow-up',
        run: {
          kind: 'triggered',
          key: 'response:response-1',
          source: { databaseId: intake, rowId: 'row-1', responseId: 'response-1' },
          triggeredBy: riley,
          plannedFor: null,
        },
      },
    ]);
  });

  it('offers nobody as Triggered by for anonymous answers (AU-14)', async () => {
    await handleFormAnswer({ store, queueRun }, answer({ respondentId: null }));
    expect(queued.map(({ run }) => run.triggeredBy)).toEqual([null]);
  });

  it('keys on the row when the answer has no response ID', async () => {
    await handleFormAnswer({ store, queueRun }, answer({ responseId: null }));
    expect(queued.map(({ run }) => [run.key, run.source])).toEqual([
      ['response:row-1', { databaseId: intake, rowId: 'row-1' }],
    ]);
  });

  it('leaves other forms, databases and workspaces alone', async () => {
    const elsewhere = [
      answer({ formId: randomUUID() }),
      answer({ databaseId: randomUUID() }),
      answer({ workspaceId: randomUUID() }),
    ];
    for (const other of elsewhere) {
      expect(await handleFormAnswer({ store, queueRun }, other)).toBe(0);
    }
    expect(queued).toEqual([]);
  });
});
