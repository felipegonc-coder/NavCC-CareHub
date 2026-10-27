// Database routes at /api/databases (decision 0200): create a database, read it as the person may
// see it, change its settings and its row access rules; the property, view and template routes
// (property-routes.ts, view-routes.ts, template-routes.ts) register here too.
// Settings writes send `version`, lock the database's row, and answer like GET /:id with the new
// version; once committed, the database's open tabs hear schema-changed on db:<id>.
import { isDeepStrictEqual } from 'node:util';
import {
  LIMITS,
  newDatabaseSchema,
  newProperty,
  relationConfig,
  uniqueViewName,
  type DatabaseGrant,
  type Id,
  type Property,
  type View,
} from '@carehub/databases';
import { atLeast, databasePageAccess, type DbAction } from '@carehub/databases/access';
import { parseRequest } from '@carehub/databases/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { registerTopic } from '../live';
import { getAccessForPages, pageAccessOf } from '../pages';
import { planAccessRules } from './access-rules';
import { DATABASE_MESSAGES, forbidden, invalid, invalidRequest, notFound } from './errors';
import {
  accept,
  allow as allowAction,
  answerFor,
  databasePage,
  hiddenProperties,
  signedIn,
} from './http';
import { createDatabasePage, loadPagePlace } from './pages';
import { registerPropertyRoutes } from './property-routes';
import { isUuid, type DatabaseRecord, type DatabaseSettings } from './record';
import {
  accessRulesRequest,
  databaseSettingsRequest,
  newDatabaseRequest,
  type DatabaseSettingsRequest,
} from './requests';
import { changeDatabase, insertDatabase, loadDatabase } from './store';
import { registerTemplateRoutes } from './template-routes';
import { followDatabaseDefault } from './templates';
import { registerViewRoutes } from './view-routes';

/** A two-way relation pair inside one database, named as given (or "Name 2" when taken). */
function relationPair(
  databaseId: Id,
  existing: readonly Property[],
  names: readonly [string, string],
  firstIsSingle: boolean,
): [Property, Property] {
  const taken = existing.map((p) => p.name);
  const firstName = uniqueViewName(names[0], taken);
  const first = newProperty(firstName, relationConfig(databaseId));
  const second = newProperty(
    uniqueViewName(names[1], [...taken, firstName]),
    relationConfig(databaseId),
  );
  first.config = { ...first.config, single: firstIsSingle, twoWayPropertyId: second.id };
  second.config = { ...second.config, twoWayPropertyId: first.id };
  return [first, second];
}

/** New properties join every view as hidden columns. */
const withHiddenColumns = (views: readonly View[], added: readonly Property[]): View[] =>
  views.map((view) => ({
    ...view,
    properties: [
      ...view.properties,
      ...added
        .filter((p) => !view.properties.some((s) => s.propertyId === p.id))
        .map((p) => ({ propertyId: p.id, visible: false })),
    ],
  }));

/** What a PATCH /:id changes, after checking the person may change each part. */
function settingsChanges(
  current: DatabaseRecord,
  input: DatabaseSettingsRequest,
  access: DatabaseGrant,
): Partial<DatabaseSettings> {
  const allow = (action: DbAction) => allowAction(action, access, current.locked);
  const changes: Partial<DatabaseSettings> = {};
  let properties = current.properties;

  if (input.locked !== undefined && input.locked !== current.locked) {
    allow('lock');
    changes.locked = input.locked;
  }
  if (input.wiki !== undefined && input.wiki !== (current.wiki === true)) {
    if (!atLeast(databasePageAccess(access), 'full')) throw forbidden();
    changes.wiki = input.wiki;
  }
  if (input.description !== undefined) {
    if (!atLeast(databasePageAccess(access), 'edit')) throw forbidden();
    changes.description = input.description;
  }
  // "Set as default for all views": the database's default, and views drop their own.
  if (input.defaultTemplateId !== undefined) {
    const id = input.defaultTemplateId;
    const views = followDatabaseDefault(current.views);
    const moved = views.some((view, i) => view !== current.views[i]);
    if (id !== current.defaultTemplateId || moved) {
      allow('manage_templates');
      if (id !== null && !current.templates.some((t) => t.id === id)) throw invalidRequest();
      if (id !== current.defaultTemplateId) changes.defaultTemplateId = id;
      if (moved) changes.views = views;
    }
  }
  if (input.rowPageLayout !== undefined) {
    allow('edit_properties');
    const layout = input.rowPageLayout;
    const known = new Set(properties.map((p) => p.id));
    if (layout && !layout.pinned.every((id) => known.has(id))) throw invalidRequest();
    changes.rowPageLayout = layout;
  }
  if (input.subItems !== undefined && input.subItems !== (current.subItems !== null)) {
    allow('edit_properties');
    if (input.subItems) {
      const [parent, children] = relationPair(
        current.id,
        properties,
        ['Parent item', 'Sub-items'],
        true,
      );
      properties = [...properties, parent, children];
      changes.subItems = { parentPropertyId: parent.id, childrenPropertyId: children.id };
    } else {
      changes.subItems = null;
    }
  }
  const dependencies = input.dependencies;
  if (dependencies === null && current.dependencies !== null) {
    allow('edit_properties');
    changes.dependencies = null;
  } else if (dependencies && current.dependencies) {
    if (dependencies.shift !== current.dependencies.shift) {
      allow('edit_properties');
      changes.dependencies = { ...current.dependencies, shift: dependencies.shift };
    }
  } else if (dependencies) {
    allow('edit_properties');
    const [blockedBy, blocking] = relationPair(
      current.id,
      properties,
      ['Blocked by', 'Blocking'],
      false,
    );
    properties = [...properties, blockedBy, blocking];
    changes.dependencies = {
      blockedByPropertyId: blockedBy.id,
      blockingPropertyId: blocking.id,
      shift: dependencies.shift,
    };
  }
  if (properties !== current.properties) {
    if (properties.length > LIMITS.properties) throw invalid(DATABASE_MESSAGES.tooManyProperties);
    const added = properties.slice(current.properties.length);
    changes.properties = properties;
    changes.views = withHiddenColumns(changes.views ?? current.views, added);
  }
  return changes;
}

export default async function databaseRoutes(app: FastifyInstance) {
  const answer = (request: FastifyRequest, record: DatabaseRecord, access: DatabaseGrant) =>
    answerFor(app.db, request, record, access);

  // Live updates on db:<id> (schema-changed here, rows-changed from the row routes): anyone who
  // can open the database page may listen.
  registerTopic('db', async ({ userId, topic }) => {
    const id = topic.slice('db:'.length);
    if (!isUuid(id)) return false;
    const level = (await getAccessForPages(app.db, userId, [id])).get(id);
    return level !== undefined && level !== 'none';
  });

  // A new database under a page the person can edit: its page, a Name property and a Table view.
  app.post('/', async (request, reply) => {
    const user = signedIn(request);
    const input = accept(parseRequest(newDatabaseRequest, request.body));
    await app.requirePageAccess('edit', () => input.parentId)(request);
    if (pageAccessOf(request).kind === 'database') throw invalidRequest();
    const parent = await loadPagePlace(app.db, input.parentId);
    if (!parent || parent.inTrash) throw notFound();
    const { properties, views } = newDatabaseSchema();
    const id = await app.db.transaction(async (tx) => {
      const pageId = await createDatabasePage(tx, {
        workspaceId: parent.workspaceId,
        spaceId: parent.spaceId,
        parentId: parent.id,
        title: input.title ?? '',
        inline: input.inline,
        createdBy: user.id,
      });
      await insertDatabase(tx, { id: pageId, workspaceId: parent.workspaceId, properties, views });
      return pageId;
    });
    const record = await loadDatabase(app.db, id);
    if (!record) throw notFound();
    const level = (await getAccessForPages(app.db, user.id, [id])).get(id) ?? 'none';
    const body = await answer(request, record, level);
    return reply.code(201).send(body);
  });

  app.get('/:id', { preHandler: app.requirePageAccess('view') }, async (request) => {
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const record = await loadDatabase(app.db, page.pageId);
    if (!record) throw notFound();
    return answer(request, record, page.level);
  });

  // Lock, wiki, default template, row page layout, sub-items, dependencies and description.
  app.patch('/:id', { preHandler: app.requirePageAccess('edit') }, async (request) => {
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const input = accept(parseRequest(databaseSettingsRequest, request.body));
    const record = await changeDatabase(app.db, page.pageId, input.version, (current) =>
      settingsChanges(current, input, page.level),
    );
    return answer(request, record, page.level);
  });

  // Row access rules: the whole list, Full access only (Lock structure doesn't stop it).
  app.put('/:id/access-rules', { preHandler: app.requirePageAccess('edit') }, async (request) => {
    const page = databasePage(request);
    const user = signedIn(request);
    const { version, rules } = accept(parseRequest(accessRulesRequest, request.body));
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      allowAction('set_row_rules', page.level, current.locked);
      const hidden = await hiddenProperties(tx, user.id, current);
      const next = planAccessRules(current, rules, hidden);
      return isDeepStrictEqual(next, current.accessRules) ? {} : { accessRules: next };
    });
    return answer(request, record, page.level);
  });

  registerPropertyRoutes(app);
  registerViewRoutes(app);
  registerTemplateRoutes(app);
}
