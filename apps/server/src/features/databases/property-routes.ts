// Property routes (decision 0200; Databases spec 3.4): add, change (a new config.type changes the
// type), delete (kept 30 days with its values), restore and duplicate. Each is a settings write: it
// sends `version`, locks the database's row and answers like GET /:id with the new version; a type
// change, or options taken out, also says how many values were cleared.
import {
  LIMITS,
  findProperty,
  type ComputedValue,
  type DatabaseGrant,
  type EvalContext,
  type Id,
  type Property,
  type Row,
} from '@carehub/databases';
import { atLeast, can, canSeeProperty, databasePageAccess } from '@carehub/databases/access';
import { planConversion } from '@carehub/databases/convert';
import {
  basicSchema,
  compileFormula,
  formulaBudget,
  type FormulaContext,
} from '@carehub/databases/formula';
import type { OptionProperty } from '@carehub/databases/options';
import { parseRequest } from '@carehub/databases/schemas';
import { numberExistingRows } from '@carehub/databases/unique-id';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db, Tx } from '../../db';
import { getAccessForPages } from '../pages';
import { DATABASE_MESSAGES, forbidden, invalid, invalidRequest, notFound } from './errors';
import { accept, allow, answerFor, databasePage, signedIn } from './http';
import {
  addToViews,
  clearedOptions,
  freeName,
  liveDeleted,
  planAdd,
  planDelete,
  planDuplicate,
  planEdit,
  planRestore,
} from './properties';
import type { DatabaseRecord, DeletedProperty } from './record';
import { newPropertyRequest, propertyChangeRequest, versionRequest } from './requests';
import {
  changeDatabase,
  copyPropertyValues,
  loadDatabase,
  loadEveryRow,
  loadMembers,
  loadPageTitles,
  loadPropertyViewer,
  loadRelatedDatabases,
  loadViewer,
  lockDatabase,
  numberRows,
  putPropertyValues,
  saveSettings,
  takePropertyValues,
  writeCells,
  type CellWrite,
} from './store';

/** How long formulas may take, in all, when a type change works out their values as text. */
const CONVERSION_FORMULA_MS = 10_000;
const EMPTY: ComputedValue = { kind: 'empty' };

type PartnerLink = { databaseId: Id; propertyId: Id };

const isOptionProperty = (p: Property): p is OptionProperty =>
  p.config.type === 'select' || p.config.type === 'multi_select' || p.config.type === 'status';

const hasValue = (row: Row, propertyId: Id): boolean => {
  const v = row.values[propertyId];
  return v !== undefined && v !== null;
};

/** DELETE sends its version in the body or as ?version=. */
function versionOf(request: FastifyRequest): number {
  const query = (request.query ?? {}) as Record<string, unknown>;
  const fromQuery = typeof query.version === 'string' ? Number(query.version) : query.version;
  const body = request.body ?? { version: fromQuery };
  return accept(parseRequest(versionRequest, body)).version;
}

const propertyIdOf = (request: FastifyRequest): string => {
  const params = request.params as { pid?: unknown };
  if (typeof params.pid !== 'string') throw notFound();
  return params.pid;
};

/** The other database, locked for this settings write; null when it's gone. */
async function lockOther(tx: Tx, id: Id): Promise<DatabaseRecord | null> {
  return (await loadDatabase(tx, id)) ? lockDatabase(tx, id) : null;
}

/** The person's level on another database page. */
async function levelOn(db: Db | Tx, userId: string, id: Id): Promise<DatabaseGrant> {
  return (await getAccessForPages(db, userId, [id])).get(id) ?? 'none';
}

export function registerPropertyRoutes(app: FastifyInstance): void {
  /** 404 unless the property exists and this person can see it (hidden ones don't exist for them). */
  async function seenProperty(userId: string, record: DatabaseRecord, id: Id): Promise<Property> {
    const prop = findProperty(record.properties, id);
    if (!prop) throw notFound();
    const viewer = await loadPropertyViewer(app.db, userId, record.workspaceId);
    if (!canSeeProperty(prop, viewer)) throw notFound();
    return prop;
  }

  /**
   * The database a new relation points at: in this workspace and not in Trash, and one the person
   * can open; a two-way relation also adds a property there, so it takes Can edit with Lock
   * structure off, and the target is locked for this write.
   */
  async function relationTarget(
    tx: Tx,
    userId: string,
    current: DatabaseRecord,
    targetId: Id,
    twoWay: boolean,
  ): Promise<DatabaseRecord> {
    const found = await loadDatabase(tx, targetId);
    if (!found || found.workspaceId !== current.workspaceId || found.inTrash) {
      throw invalidRequest();
    }
    const level = await levelOn(tx, userId, targetId);
    if (!twoWay) {
      if (!atLeast(databasePageAccess(level), 'view')) throw forbidden();
      return found;
    }
    const target = await lockDatabase(tx, targetId);
    allow('edit_properties', level, target.locked);
    return target;
  }

  /** The values a type change works with: names, the person's clock, related titles, formulas. */
  async function conversionContext(
    userId: string,
    record: DatabaseRecord,
    prop: Property,
    rows: readonly Row[],
  ): Promise<{ ctx: EvalContext; findUser: (text: string) => Id | undefined }> {
    const [viewer, members] = await Promise.all([
      loadViewer(app.db, userId),
      loadMembers(app.db, record.workspaceId),
    ]);
    const names = new Map(members.map((m) => [m.id, m.name]));
    const ctx: EvalContext = {
      properties: record.properties,
      viewer,
      userName: (id) => names.get(id),
    };
    const config = prop.config;
    if (config.type === 'relation') {
      // Relation to Text: titles of the related rows this person can open.
      const linked = new Set<string>();
      for (const row of rows) {
        const links = row.values[prop.id];
        if (Array.isArray(links))
          for (const id of links) if (typeof id === 'string') linked.add(id);
      }
      const ids = [...linked];
      const levels = ids.length > 0 ? await getAccessForPages(app.db, userId, ids) : null;
      const titles = await loadPageTitles(
        app.db,
        ids.filter((id) => atLeast(levels?.get(id), 'view')),
      );
      ctx.rowTitle = (id) => titles.get(id);
    }
    if (config.type === 'formula') {
      // Formula to Text keeps the values as shown (reading this row's properties).
      const compiled = compileFormula(config.expression, basicSchema(record.properties));
      if (compiled.ok) {
        const emails = new Map(members.map((m) => [m.id, m.email]));
        const fctx: FormulaContext = {
          ...ctx,
          page: () => null,
          userEmail: (id) => emails.get(id),
          clock: () => Date.now(),
        };
        fctx.budget = formulaBudget(fctx, CONVERSION_FORMULA_MS);
        ctx.computed = (row, propertyId) =>
          propertyId === prop.id ? compiled.run(row, fctx) : EMPTY;
      }
    }
    const findUser = (text: string): Id | undefined => {
      const name = text.trim();
      const email = name.toLowerCase();
      const member =
        members.find((m) => m.name === name) ??
        members.find((m) => m.email.toLowerCase() === email);
      return member?.id;
    };
    return { ctx, findUser };
  }

  /** ID numbers for the rows that have none, oldest first, after every number given so far. */
  async function numberEveryRow(tx: Tx, current: DatabaseRecord, rows?: readonly Row[]) {
    const all = rows ?? (await loadEveryRow(tx, current.id));
    await numberRows(tx, current.id, numberExistingRows(all, current.nextUniqueNumber - 1));
  }

  /** The other side of a relation that changed type: still a relation there, now one-way. */
  async function partnerOneWay(tx: Tx, link: PartnerLink): Promise<void> {
    const other = await lockOther(tx, link.databaseId);
    const partner = other ? findProperty(other.properties, link.propertyId) : undefined;
    if (!other || partner?.config.type !== 'relation') return;
    const config = { ...partner.config, twoWayPropertyId: null };
    const properties = other.properties.map((p) => (p.id === partner.id ? { ...p, config } : p));
    await saveSettings(tx, other, { properties });
  }

  /** Deleting a two-way relation deletes its partner in the other database too (Can edit there). */
  async function deletePartner(tx: Tx, userId: string, link: PartnerLink, now: Date) {
    const other = await lockOther(tx, link.databaseId);
    const partner = other ? findProperty(other.properties, link.propertyId) : undefined;
    if (!other || !partner) return;
    allow('edit_properties', await levelOn(tx, userId, other.id), other.locked);
    const plan = planDelete(other, partner.id);
    const entry: DeletedProperty = {
      property: partner,
      deletedAt: now.toISOString(),
      values: await takePropertyValues(tx, other.id, partner.id),
    };
    await saveSettings(tx, other, {
      ...plan.changes,
      deletedProperties: [...liveDeleted(other.deletedProperties, now), entry],
    });
  }

  /**
   * The other database of a deleted two-way relation, locked, when its side can come back too:
   * still deleted there (within 30 days) and the person can change its properties.
   */
  async function restorableOther(
    tx: Tx,
    userId: string,
    current: DatabaseRecord,
    propertyId: Id,
    now: Date,
  ): Promise<DatabaseRecord | null> {
    const entry = current.deletedProperties.find((d) => d.property.id === propertyId);
    const config = entry?.property.config;
    if (config?.type !== 'relation' || config.twoWayPropertyId === null) return null;
    if (config.targetDatabaseId === current.id) return null;
    const other = await lockOther(tx, config.targetDatabaseId);
    if (!other) return null;
    const partnerId = config.twoWayPropertyId;
    const waiting = liveDeleted(other.deletedProperties, now).some(
      (d) => d.property.id === partnerId,
    );
    const level = await levelOn(tx, userId, other.id);
    return waiting && can('edit_properties', level, { locked: other.locked }) ? other : null;
  }

  // A new property; the request names where it shows in one view, if it likes.
  app.post('/:id/properties', { preHandler: app.requirePageAccess('edit') }, async (request) => {
    const page = databasePage(request);
    const user = signedIn(request);
    const { version, ...input } = accept(parseRequest(newPropertyRequest, request.body));
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      allow('edit_properties', page.level, current.locked);
      if (input.access) allow('set_property_access', page.level, current.locked);
      const config = input.config;
      const twoWay = config.type === 'relation' && config.twoWayPropertyId !== null;
      const target =
        config.type === 'relation' && config.targetDatabaseId !== current.id
          ? await relationTarget(tx, user.id, current, config.targetDatabaseId, twoWay)
          : null;
      const related = await loadRelatedDatabases(tx, current.properties);
      if (target) related.set(target.id, target.properties);
      const plan = planAdd(current, input, related);
      if (plan.partner && target) {
        const partner = { ...plan.partner, name: freeName(target.properties, plan.partner.name) };
        const properties = [...target.properties, partner];
        if (properties.length > LIMITS.properties) {
          throw invalid(DATABASE_MESSAGES.tooManyProperties);
        }
        await saveSettings(tx, target, { properties, views: addToViews(target.views, partner) });
      }
      if (plan.property.config.type === 'unique_id') await numberEveryRow(tx, current);
      return plan.changes;
    });
    return answerFor(app.db, request, record, page.level);
  });

  // Name, description, row page display, access (Full access) and settings; a new type converts.
  app.patch(
    '/:id/properties/:pid',
    { preHandler: app.requirePageAccess('edit') },
    async (request) => {
      const page = databasePage(request);
      const user = signedIn(request);
      const propertyId = propertyIdOf(request);
      const { version, ...input } = accept(parseRequest(propertyChangeRequest, request.body));
      let cleared: number | undefined;
      const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
        const { access, ...rest } = input;
        if (Object.values(rest).some((v) => v !== undefined)) {
          allow('edit_properties', page.level, current.locked);
        }
        if (access !== undefined) allow('set_property_access', page.level, current.locked);
        await seenProperty(user.id, current, propertyId);
        const related = await loadRelatedDatabases(tx, current.properties);
        const plan = planEdit(current, propertyId, input, related);
        if (plan.conversion) {
          const rows = await loadEveryRow(tx, current.id);
          const { ctx, findUser } = await conversionContext(user.id, current, plan.before, rows);
          const result = planConversion(plan.before, plan.property.config, rows, ctx, {
            findUser,
          });
          plan.property.config = result.config;
          const cells: CellWrite[] = rows
            .filter((row) => hasValue(row, propertyId) || result.values.has(row.id))
            .map((row) => ({ rowId: row.id, propertyId, value: result.values.get(row.id) }));
          await writeCells(tx, [current.id], cells);
          cleared = result.cleared;
          if (plan.numberRows) await numberEveryRow(tx, current, rows);
          if (plan.partner) await partnerOneWay(tx, plan.partner);
        } else if (plan.removedOptionIds.length > 0 && isOptionProperty(plan.before)) {
          const cells = clearedOptions(
            await loadEveryRow(tx, current.id),
            plan.before,
            plan.removedOptionIds,
          );
          await writeCells(tx, [current.id], cells);
          cleared = cells.length;
        }
        return plan.changes;
      });
      const body = await answerFor(app.db, request, record, page.level);
      return cleared === undefined ? body : { ...body, cleared };
    },
  );

  // Delete: its values go with it into the database's deleted properties for 30 days.
  app.delete(
    '/:id/properties/:pid',
    { preHandler: app.requirePageAccess('edit') },
    async (request) => {
      const page = databasePage(request);
      const user = signedIn(request);
      const propertyId = propertyIdOf(request);
      const version = versionOf(request);
      const now = new Date();
      const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
        allow('edit_properties', page.level, current.locked);
        await seenProperty(user.id, current, propertyId);
        const plan = planDelete(current, propertyId);
        if (plan.partner) await deletePartner(tx, user.id, plan.partner, now);
        const deleted: DeletedProperty[] = [];
        for (const id of plan.deletedIds) {
          const property = findProperty(current.properties, id);
          if (!property) continue;
          const values = await takePropertyValues(tx, current.id, id);
          deleted.push({ property, deletedAt: now.toISOString(), values });
        }
        return {
          ...plan.changes,
          deletedProperties: [...liveDeleted(current.deletedProperties, now), ...deleted],
        };
      });
      return answerFor(app.db, request, record, page.level);
    },
  );

  // Restore within 30 days, with its values (and a two-way partner where it can come back too).
  app.post(
    '/:id/properties/:pid/restore',
    { preHandler: app.requirePageAccess('edit') },
    async (request) => {
      const page = databasePage(request);
      const user = signedIn(request);
      const propertyId = propertyIdOf(request);
      const { version } = accept(parseRequest(versionRequest, request.body));
      const now = new Date();
      const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
        allow('edit_properties', page.level, current.locked);
        const entry = current.deletedProperties.find((d) => d.property.id === propertyId);
        const viewer = await loadPropertyViewer(app.db, user.id, current.workspaceId);
        if (!entry || !canSeeProperty(entry.property, viewer)) throw notFound();
        const other = await restorableOther(tx, user.id, current, propertyId, now);
        const plan = planRestore(current, propertyId, now, () => other !== null);
        for (const d of plan.restored) {
          await putPropertyValues(tx, current.id, d.property.id, d.values);
        }
        if (plan.partner && other) {
          const back = planRestore(other, plan.partner.propertyId, now, () => true);
          for (const d of back.restored) {
            await putPropertyValues(tx, other.id, d.property.id, d.values);
          }
          await saveSettings(tx, other, back.changes);
        }
        return plan.changes;
      });
      return answerFor(app.db, request, record, page.level);
    },
  );

  // Duplicate: a copy next to it, with its values (a two-way relation's copy is one-way).
  app.post(
    '/:id/properties/:pid/duplicate',
    { preHandler: app.requirePageAccess('edit') },
    async (request) => {
      const page = databasePage(request);
      const user = signedIn(request);
      const propertyId = propertyIdOf(request);
      const { version } = accept(parseRequest(versionRequest, request.body));
      const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
        allow('edit_properties', page.level, current.locked);
        await seenProperty(user.id, current, propertyId);
        const plan = planDuplicate(current, propertyId);
        if (plan.copyValues) {
          await copyPropertyValues(tx, current.id, plan.source.id, plan.copy.id);
        }
        return plan.changes;
      });
      return answerFor(app.db, request, record, page.level);
    },
  );
}
