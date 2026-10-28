import type { AutomationView, RunView } from '@carehub/team-automations/api';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { sqlRunnerFor } from '../jobs';
import type { Automation, AutomationStore, Run } from './domain/types';
import { createAutomationsService, type Caller } from './service';
import { createPostgresAutomationStore } from './store';

export interface AutomationsRoutesOptions {
  /** Defaults to the Postgres store on `app.db`. */
  store?: AutomationStore;
  now?: () => Date;
}

const params = z.object({ id: z.string().min(1).max(100) });
const iso = (value: Date | null) => value?.toISOString() ?? null;

export function toAutomationView(automation: Automation): AutomationView {
  const { lastRun } = automation;
  return {
    id: automation.id,
    name: automation.name,
    ownerUserId: automation.ownerUserId,
    enabled: automation.enabled,
    trigger: automation.trigger,
    conditions: automation.conditions,
    variables: automation.variables,
    actions: automation.actions,
    nextRunAt: iso(automation.nextRunAt),
    pausedReason: automation.pausedReason,
    lastRun: lastRun ? { result: lastRun.result, at: lastRun.at.toISOString() } : null,
    createdAt: automation.createdAt.toISOString(),
    updatedAt: automation.updatedAt.toISOString(),
  };
}

/** A run as the history shows it; the run key stays on the server. */
export function toRunView(run: Run): RunView {
  return {
    id: run.id,
    kind: run.kind,
    plannedFor: iso(run.plannedFor),
    ranAt: iso(run.ranAt),
    finishedAt: iso(run.finishedAt),
    result: run.result,
    source: run.source,
    steps: run.steps,
    recipients: run.recipients,
    error: run.error,
    startedBy: run.startedBy,
    createdAt: run.createdAt.toISOString(),
  };
}

/**
 * Settings → Automations, for Admins only (AU-D1): `app.requirePermission('workspace.admin')`
 * answers 401 when signed out and 403 for anyone else, guests and outsiders included (AU-09).
 */
const automationsRoutes: FastifyPluginAsync<AutomationsRoutesOptions> = async (app, options) => {
  const store = options.store ?? createPostgresAutomationStore(sqlRunnerFor(app.db));
  const service = createAutomationsService({ store, now: options.now });
  app.addHook('preHandler', app.requirePermission('workspace.admin'));

  /** The Admin asking, in their workspace (`request.member`, decision 0007, section 3.1). */
  function admin(request: FastifyRequest): Caller {
    // The guard lets only signed-in Admins through; this only narrows the types.
    if (!request.user || !request.member) throw httpError(403, 'forbidden');
    return { workspaceId: request.member.workspaceId, userId: request.user.id };
  }
  const id = (request: FastifyRequest) => params.parse(request.params).id;

  app.get('/', async (request) => {
    const automations = await service.list(admin(request), request.query);
    return { automations: automations.map(toAutomationView) };
  });

  app.post('/', async (request, reply) => {
    const automation = await service.create(admin(request), request.body);
    return reply.code(201).send({ automation: toAutomationView(automation) });
  });

  app.get('/:id', async (request) => ({
    automation: toAutomationView(await service.get(admin(request), id(request))),
  }));

  app.patch('/:id', async (request) => ({
    automation: toAutomationView(await service.update(admin(request), id(request), request.body)),
  }));

  app.delete('/:id', async (request, reply) => {
    await service.remove(admin(request), id(request));
    return reply.code(204).send();
  });

  app.get('/:id/runs', async (request) => {
    const runs = await service.runs(admin(request), id(request));
    return { runs: runs.map(toRunView) };
  });
};

export default automationsRoutes;
