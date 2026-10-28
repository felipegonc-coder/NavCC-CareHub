/**
 * The Form response trigger (Automations spec, section 3; AU-14): each answer through the chosen
 * form queues one run of every switched-on automation watching that form, with the respondent as
 * Triggered by (nobody for anonymous forms). The runner then checks the conditions and the owner.
 */
import type { AutomationStore } from '../domain/types';
import type { FormAnswer } from './databases';
import type { QueueRun } from './runner';

export interface FormResponseDeps {
  store: AutomationStore;
  queueRun: QueueRun;
}

/** Queues the runs for one answer; returns how many. */
export async function handleFormAnswer(deps: FormResponseDeps, answer: FormAnswer) {
  const { workspaceId, databaseId, formId, rowId, responseId } = answer;
  const automations = await deps.store.list(workspaceId, { databaseId, enabled: true });
  let queued = 0;
  for (const automation of automations) {
    const { trigger } = automation;
    if (trigger.kind !== 'formResponse') continue;
    if (trigger.formId !== formId || trigger.databaseId !== databaseId) continue;
    await deps.queueRun(automation, {
      kind: 'triggered',
      key: `response:${responseId ?? rowId}`,
      source: responseId === null ? { databaseId, rowId } : { databaseId, rowId, responseId },
      triggeredBy: answer.respondentId,
      plannedFor: null,
    });
    queued += 1;
  }
  return queued;
}
