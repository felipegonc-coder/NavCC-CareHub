// Template routes (decision 0200; Templates and buttons spec 3.2): add, change and delete a
// database's row templates. Each is a settings write: it sends `version`, locks the database's row
// and answers like GET /:id with the new version, plus `templateId` for a new template. A
// template's page is a row page under the database with no db_rows entry (its title follows the
// Name preset); a repeating template keeps its next run in db_repeat_state for the repeat job.
// Setting the default is a view setting (PATCH /:id/views/:vid) or PATCH /:id for all views.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { titleProperty, type Id, type RowTemplate } from '@carehub/databases';
import { parseRequest } from '@carehub/databases/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Tx } from '../../db';
import { notFound } from './errors';
import {
  accept,
  allow,
  answerFor,
  databasePage,
  hiddenProperties,
  signedIn,
  versionOf,
} from './http';
import { createTemplatePage, deleteTemplatePage, setTemplatePageTitle } from './pages';
import type { DatabaseRecord } from './record';
import { templateRequest } from './requests';
import { changeDatabase, dropRepeatState, saveRepeatState } from './store';
import {
  planDeleteTemplate,
  planEditTemplate,
  planNewTemplate,
  type TemplateEditor,
} from './templates';

const templateIdOf = (request: FastifyRequest): string => {
  const params = request.params as { tid?: unknown };
  if (typeof params.tid !== 'string') throw notFound();
  return params.tid;
};

/** A template page's title: the template's Name preset, or none. */
function pageTitle(record: DatabaseRecord, template: RowTemplate): string {
  const value = template.values[titleProperty(record.properties).id];
  return typeof value === 'string' ? value : '';
}

/** Who is saving: the properties they can't see matter only when presets are sent. */
async function editorOf(
  tx: Tx,
  userId: Id,
  record: DatabaseRecord,
  values: unknown,
): Promise<TemplateEditor> {
  const hidden = values === undefined ? new Set<Id>() : await hiddenProperties(tx, userId, record);
  return { userId, hidden };
}

export function registerTemplateRoutes(app: FastifyInstance): void {
  const edit = { preHandler: app.requirePageAccess('edit') };

  // A new template, last: its presets, an optional repeat (run as the person who sets it up) and
  // its page.
  app.post('/:id/templates', edit, async (request) => {
    const page = databasePage(request);
    const user = signedIn(request);
    const { version, ...input } = accept(parseRequest(templateRequest, request.body));
    const templateId = randomUUID();
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      allow('manage_templates', page.level, current.locked);
      const editor = await editorOf(tx, user.id, current, input.values);
      const plan = planNewTemplate(current, templateId, input, editor);
      await createTemplatePage(tx, {
        id: templateId,
        databaseId: current.id,
        workspaceId: current.workspaceId,
        spaceId: current.spaceId,
        title: pageTitle(current, plan.template),
        createdBy: user.id,
      });
      if (plan.template.repeat) await saveRepeatState(tx, current.id, plan.template, new Date());
      return { templates: plan.templates };
    });
    return { ...(await answerFor(app.db, request, record, page.level)), templateId };
  });

  // A template's name, icon, presets or repeat. Presets the person can't see stay as they were.
  app.patch('/:id/templates/:tid', edit, async (request) => {
    const page = databasePage(request);
    const user = signedIn(request);
    const templateId = templateIdOf(request);
    const { version, ...patch } = accept(parseRequest(templateRequest, request.body));
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      allow('manage_templates', page.level, current.locked);
      const editor = await editorOf(tx, user.id, current, patch.values);
      const plan = planEditTemplate(current, templateId, patch, editor);
      if (isDeepStrictEqual(plan.template, plan.before)) return {};
      const title = pageTitle(current, plan.template);
      if (title !== pageTitle(current, plan.before)) {
        await setTemplatePageTitle(tx, templateId, current.id, title, user.id);
      }
      if (!isDeepStrictEqual(plan.template.repeat ?? null, plan.before.repeat ?? null)) {
        await saveRepeatState(tx, current.id, plan.template, new Date());
      }
      return { templates: plan.templates };
    });
    return answerFor(app.db, request, record, page.level);
  });

  // A template and its page, for good. Defaults that pointed at it go back to the database's (or
  // an empty row), and its repeat stops.
  app.delete('/:id/templates/:tid', edit, async (request) => {
    const page = databasePage(request);
    const templateId = templateIdOf(request);
    const version = versionOf(request);
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      allow('manage_templates', page.level, current.locked);
      const plan = planDeleteTemplate(current, templateId);
      await deleteTemplatePage(tx, templateId, current.id);
      await dropRepeatState(tx, templateId);
      const movedViews = plan.views.some((view, i) => view !== current.views[i]);
      return {
        templates: plan.templates,
        ...(plan.defaultTemplateId !== current.defaultTemplateId
          ? { defaultTemplateId: plan.defaultTemplateId }
          : {}),
        ...(movedViews ? { views: plan.views } : {}),
      };
    });
    return answerFor(app.db, request, record, page.level);
  });
}
