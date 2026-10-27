// What one query reads besides its own rows (W2-3): the schemas of related databases and the
// property access they give this viewer, then one row cache per request with the related rows that
// relation cells, formulas and rollups read, loaded in rounds and kept only when the viewer can open
// them. Values the viewer can't see are taken out, and so are titles of mentioned pages they can't
// open, before anything reads the rows.
import { LIMITS, type AccessLevel, type Id, type Property, type Row } from '@carehub/databases';
import { atLeast, type PropertyViewer } from '@carehub/databases/access';
import { withoutHidden } from '@carehub/databases/engine';
import { sql } from 'drizzle-orm';
import { getAccessForPages } from '../pages';
import { hideMentionTitles } from './meta';
import { isUuid } from './record';
import { loadRows, uuidList, type Executor } from './store';
import {
  linkIds,
  relationTargets,
  schemasFor,
  type DatabaseSchema,
  type Schemas,
} from './view-access';

/** Related databases one query reads, besides its own (as loadRelatedProperties). */
export const RELATED_DATABASES = 25;
/** Related rows one query loads; formulas and rollups that need more say "⚠ Too slow". */
export const RELATED_ROWS = LIMITS.rows;
/** Hops followed: every formula in the longest chain may read two relations away. */
const ROUNDS = LIMITS.computedChain * LIMITS.formulaRelationDepth;
/** Ids per lookup. */
const CHUNK = 5_000;

/** A related row the viewer can open. */
export interface CachedRow {
  row: Row;
  databaseId: Id;
}

/** The rows one query reads. */
export interface RowCache {
  /** The query's rows, in the order given, the ones the viewer can open cleaned for them. */
  homeRows: Row[];
  /** Rows of other databases the viewer can open. */
  rows: ReadonlyMap<Id, CachedRow>;
  /** Linked rows left unloaded because the cache was full: what reads them says "⚠ Too slow". */
  skipped: ReadonlySet<Id>;
}

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The viewer's level on each page, in batches. */
export async function accessLevels(
  db: Executor,
  userId: string,
  pageIds: readonly string[],
): Promise<Map<string, AccessLevel>> {
  const out = new Map<string, AccessLevel>();
  for (const part of chunks([...new Set(pageIds)])) {
    for (const [id, level] of await getAccessForPages(db, userId, part)) out.set(id, level);
  }
  return out;
}

/**
 * The schemas a query needs and property access for this viewer: the database and the ones its
 * relations reach (and theirs, up to RELATED_DATABASES; none in Trash). See schemasFor.
 */
export async function loadSchemas(
  db: Executor,
  home: { id: Id; properties: readonly Property[] },
  viewer: PropertyViewer,
): Promise<Schemas> {
  const databases = new Map<Id, readonly Property[]>([[home.id, home.properties]]);
  const seen = new Set<Id>([home.id]);
  let next = relationTargets(home.properties);
  while (seen.size <= RELATED_DATABASES) {
    const batch = [...new Set(next)]
      .filter((id) => isUuid(id) && !seen.has(id))
      .slice(0, RELATED_DATABASES + 1 - seen.size);
    if (batch.length === 0) break;
    for (const id of batch) seen.add(id);
    const { rows } = await db.execute<{ id: string; properties: Property[] | null }>(sql`
      SELECT d.page_id AS id, d.properties
      FROM db_databases d JOIN pages p ON p.id = d.page_id
      WHERE d.page_id = ANY(${uuidList(batch)}) AND p.deleted_at IS NULL`);
    for (const r of rows) databases.set(r.id, r.properties ?? []);
    next = rows.flatMap((r) => relationTargets(r.properties ?? []));
  }
  return schemasFor(home.id, databases, viewer);
}

/** Page ids mentioned in rich text. */
function mentionsIn(value: unknown, into: Set<Id>): void {
  if (!Array.isArray(value)) return;
  for (const span of value) {
    const mention = (span as { mention?: { kind?: unknown; id?: unknown } } | null)?.mention;
    if (mention?.kind === 'page' && typeof mention.id === 'string') into.add(mention.id);
  }
}

/** What cleanRow needs: which links still exist, and which mentioned pages the viewer can open. */
interface Cleaning {
  schemas: Schemas;
  exists(id: Id): boolean;
  openable: ReadonlySet<Id>;
}

/**
 * The row with links to rows that are gone (deleted, in Trash) left out of followed relations to
 * databases the cache reads, and the titles of mentioned pages the viewer can't open left out.
 */
function cleanRow(row: Row, schema: DatabaseSchema, c: Cleaning): Row {
  let values: Row['values'] | null = null;
  for (const p of schema.shown) {
    const value = row.values[p.id];
    if (value === undefined || value === null) continue;
    let next: unknown = value;
    if (p.config.type === 'relation') {
      const target = p.config.targetDatabaseId;
      if (c.schemas.followed.has(p.id) && c.schemas.byId.has(target)) {
        const links = linkIds(value);
        const kept = links.filter((id) => c.exists(id));
        if (kept.length !== links.length || !Array.isArray(value)) next = kept;
      }
    } else if (p.config.type === 'text') next = hideMentionTitles(value, c.openable);
    if (next !== value) {
      values ??= { ...row.values };
      values[p.id] = next;
    }
  }
  return values ? { ...row, values } : row;
}

export interface RowCacheInput {
  userId: string;
  schemas: Schemas;
  /** Every row of the query's database (loadRows). */
  rows: readonly Row[];
  /** The viewer's level on each of those rows. */
  levels: ReadonlyMap<Id, AccessLevel>;
}

/**
 * Loads the rows linked from the rows the viewer can open, through followed relations, round by
 * round (each round one load per database and one access lookup), up to RELATED_ROWS rows and
 * ROUNDS hops. Rows the viewer can't open are never followed or kept.
 */
export async function loadRowCache(db: Executor, input: RowCacheInput): Promise<RowCache> {
  const { schemas, levels } = input;
  const { home, followed } = schemas;
  const canOpen = (id: Id) => atLeast(levels.get(id), 'view');
  /** Rows that exist: the query's own, and linked ones found. */
  const live = new Set(input.rows.map((r) => r.id));
  const asked = new Set<Id>();
  const known = new Map(levels);
  const rows = new Map<Id, CachedRow>();
  const skipped = new Set<Id>();
  let loaded = 0;

  /** Links of followed relations to other databases this cache knows, by database. */
  const linksOf = (row: Row, schema: DatabaseSchema, into: Map<Id, Set<Id>>) => {
    for (const p of schema.shown) {
      if (p.config.type !== 'relation' || !followed.has(p.id)) continue;
      const target = p.config.targetDatabaseId;
      if (target === home.id || !schemas.byId.has(target)) continue;
      for (const id of linkIds(row.values[p.id])) {
        if (live.has(id) || asked.has(id) || skipped.has(id) || !isUuid(id)) continue;
        let set = into.get(target);
        if (!set) into.set(target, (set = new Set()));
        set.add(id);
      }
    }
  };

  let frontier = new Map<Id, Set<Id>>();
  for (const row of input.rows) if (canOpen(row.id)) linksOf(row, home, frontier);
  for (let round = 0; round < ROUNDS && frontier.size > 0; round++) {
    const next = new Map<Id, Set<Id>>();
    for (const [databaseId, ids] of frontier) {
      const schema = schemas.byId.get(databaseId);
      if (!schema) continue;
      let list = [...ids].filter((id) => !live.has(id) && !asked.has(id) && !skipped.has(id));
      const room = Math.max(0, RELATED_ROWS - loaded);
      for (const id of list.slice(room)) skipped.add(id);
      list = list.slice(0, room);
      if (list.length === 0) continue;
      const found: Row[] = [];
      for (const part of chunks(list)) found.push(...(await loadRows(db, databaseId, part)));
      loaded += found.length;
      for (const id of list) asked.add(id);
      for (const row of found) live.add(row.id);
      const access = await accessLevels(
        db,
        input.userId,
        found.map((r) => r.id),
      );
      const stripping = schema.shown.length < schema.properties.length;
      for (const row of found) {
        const level = access.get(row.id) ?? 'none';
        known.set(row.id, level);
        if (!atLeast(level, 'view')) continue;
        const clean = withoutHidden(row, schema.visible, stripping);
        rows.set(row.id, { row: clean, databaseId });
        linksOf(clean, schema, next);
      }
    }
    frontier = next;
  }
  for (const ids of frontier.values()) {
    for (const id of ids) if (!live.has(id) && !asked.has(id)) skipped.add(id);
  }

  // Links to rows that are gone (deleted, in Trash) are left out; mentions need the viewer's access.
  const exists = (id: Id) => live.has(id) || skipped.has(id);
  const mentioned = new Set<Id>();
  const homeText = home.shown.filter((p) => p.config.type === 'text');
  for (const row of input.rows) {
    if (!canOpen(row.id)) continue;
    for (const p of homeText) mentionsIn(row.values[p.id], mentioned);
  }
  for (const { row, databaseId } of rows.values()) {
    for (const p of schemas.byId.get(databaseId)?.shown ?? []) {
      if (p.config.type === 'text') mentionsIn(row.values[p.id], mentioned);
    }
  }
  const unknown = [...mentioned].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    for (const [id, level] of await accessLevels(db, input.userId, unknown)) known.set(id, level);
  }
  const openable = new Set([...mentioned].filter((id) => atLeast(known.get(id), 'view')));

  const cleaning: Cleaning = { schemas, exists, openable };
  const homeRows = input.rows.map((row) => (canOpen(row.id) ? cleanRow(row, home, cleaning) : row));
  for (const [id, hit] of rows) {
    const schema = schemas.byId.get(hit.databaseId);
    if (schema) rows.set(id, { ...hit, row: cleanRow(hit.row, schema, cleaning) });
  }
  return { homeRows, rows, skipped };
}
