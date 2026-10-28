/**
 * Starts the database triggers: the Date arrives check every 30 seconds, one at a time across
 * servers, and the Form response listener. Runs go to the runner through its `queueRun`.
 */
import type { FastifyInstance } from 'fastify';
import { registerPeriodicTask, sqlRunnerFor } from '../../jobs';
import { getDefaultWorkspace } from '../../workspaces';
import type { AutomationStore } from '../domain/types';
import { checkDates, DATES_EVERY_MS, DATES_TASK } from './dateArrives';
import { createPostgresDateChecks, type DateChecks } from './dateChecks';
import { databasesStandIn, type TriggerDatabases } from './databases';
import { handleFormAnswer } from './formResponse';
import type { ActingOwner, PauseAutomation, QueueRun } from './runner';

export interface TriggerOptions {
  store: AutomationStore;
  queueRun: QueueRun;
  actingOwner: ActingOwner;
  pause: PauseAutomation;
  /** Defaults to automations_date_checks on `app.db`. */
  checks?: DateChecks;
  /** Defaults to the stand-ins until Databases is on main. */
  databases?: TriggerDatabases;
}

export function registerAutomationTriggers(app: FastifyInstance, options: TriggerOptions): void {
  const { store, queueRun } = options;
  const databases = options.databases ?? databasesStandIn;
  const deps = {
    ...options,
    checks: options.checks ?? createPostgresDateChecks(sqlRunnerFor(app.db)),
    listDatedRows: databases.listDatedRows,
    workspaceIds: async () => {
      const workspace = await getDefaultWorkspace(app.db);
      return workspace ? [workspace.id] : [];
    },
  };
  registerPeriodicTask(DATES_TASK, DATES_EVERY_MS, ({ now }) => checkDates(deps, now));
  const stop = databases.onFormAnswer(async (answer) => {
    await handleFormAnswer({ store, queueRun }, answer);
  });
  app.addHook('onClose', async () => stop());
}
