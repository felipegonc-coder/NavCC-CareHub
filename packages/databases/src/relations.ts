/**
 * Relations: what changed in a cell, the writes that keep both sides of a two-way relation in
 * step, links when a database is duplicated, and related rows the viewer can't open (spec 3.4).
 */
import { THIS_PAGE, type ConfigOf, type Id, type Property, type Row } from './types';

/** How a relation cell's links changed. */
export interface LinkDiff {
  /** Linked now and not before, in the new order. */
  added: Id[];
  /** Linked before and not now, in the old order. */
  removed: Id[];
}

/** What changed between two values of a relation cell (empty cells are null or missing). */
export function linkDiff(
  before: readonly Id[] | null | undefined,
  after: readonly Id[] | null | undefined,
): LinkDiff {
  const old = new Set(before ?? []);
  const now = new Set(after ?? []);
  return {
    added: [...now].filter((id) => !old.has(id)),
    removed: [...old].filter((id) => !now.has(id)),
  };
}

/** A relation cell to save on another row. */
export interface RelationWrite {
  rowId: Id;
  /** The partner property, or the source property for a row whose link the partner replaced. */
  propertyId: Id;
  /** The cell's new links; null clears it. */
  value: Id[] | null;
}

/** Reads a relation cell's current links. */
export type ReadLinks = (rowId: Id) => readonly Id[] | null | undefined;

/**
 * The writes that keep a two-way relation matching after `sourceRowId`'s links changed by `diff`:
 * each newly linked row lists the source row in `partner`, and each unlinked row stops listing it.
 * When the partner allows one row only, the source row replaces its old link; with `readSource`
 * (the source property's links), the row it replaced also drops its link back, so both sides stay
 * in step. Only cells that change are returned. The caller checks them like any value (a partner
 * cell may already hold 500 links).
 */
export function twoWayWrites(
  sourceRowId: Id,
  diff: LinkDiff,
  partner: Property<ConfigOf<'relation'>>,
  readPartner: ReadLinks,
  readSource?: ReadLinks,
): RelationWrite[] {
  const sourcePropertyId = partner.config.twoWayPropertyId;
  const cells = new Map<string, { write: RelationWrite; links: Id[]; was: readonly Id[] }>();
  const cell = (propertyId: Id, rowId: Id, read: ReadLinks): Id[] => {
    const key = JSON.stringify([propertyId, rowId]);
    let c = cells.get(key);
    if (!c) {
      const was = read(rowId) ?? [];
      c = { write: { rowId, propertyId, value: null }, links: [...was], was };
      cells.set(key, c);
    }
    return c.links;
  };
  const drop = (links: Id[], id: Id) => {
    for (let i = links.indexOf(id); i !== -1; i = links.indexOf(id)) links.splice(i, 1);
  };
  for (const rowId of diff.removed) drop(cell(partner.id, rowId, readPartner), sourceRowId);
  for (const rowId of diff.added) {
    const links = cell(partner.id, rowId, readPartner);
    if (!partner.config.single) {
      if (!links.includes(sourceRowId)) links.push(sourceRowId);
      continue;
    }
    const replaced = links.filter((id) => id !== sourceRowId);
    links.splice(0, links.length, sourceRowId);
    if (!readSource || !sourcePropertyId) continue;
    for (const other of replaced) drop(cell(sourcePropertyId, other, readSource), rowId);
  }
  const out: RelationWrite[] = [];
  for (const { write, links, was } of cells.values()) {
    // A relation that is its own partner: the source row's cell is the caller's own write.
    if (write.propertyId === sourcePropertyId && write.rowId === sourceRowId) continue;
    if (links.length === was.length && links.every((id, i) => id === was[i])) continue;
    out.push({ ...write, value: links.length ? links : null });
  }
  return out;
}

/**
 * The links for a new two-way partner property (turning on "Also show on the target"): target row
 * id → the rows that link to it through `relationPropertyId`, in row order.
 */
export function backLinks(rows: readonly Row[], relationPropertyId: Id): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  for (const row of rows) {
    const links = row.values[relationPropertyId];
    if (!Array.isArray(links)) continue;
    for (const target of links) {
      if (typeof target !== 'string' || target === '') continue;
      const list = out.get(target) ?? [];
      if (!list.includes(row.id)) list.push(row.id);
      out.set(target, list);
    }
  }
  return out;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Property settings for the copy of a database (spec 3.1 Duplicate), with the same property ids.
 * Relations to the database itself target the copy (a two-way pair inside it stays two-way); two-way
 * relations to other databases become one-way, so the other database isn't changed. Also returns
 * the relations to the database itself, for remapForDuplicate.
 */
export function duplicateRelations(
  properties: readonly Property[],
  sourceDatabaseId: Id,
  copyDatabaseId: Id,
): { properties: Property[]; sameDatabaseRelationIds: Id[] } {
  const sameDatabaseRelationIds: Id[] = [];
  const out = properties.map((p): Property => {
    const c = p.config;
    if (c.type !== 'relation') return copy(p);
    if (c.targetDatabaseId === sourceDatabaseId) {
      sameDatabaseRelationIds.push(p.id);
      return { ...copy(p), config: { ...c, targetDatabaseId: copyDatabaseId } };
    }
    return { ...copy(p), config: { ...c, twoWayPropertyId: null } };
  });
  return { properties: out, sameDatabaseRelationIds };
}

/**
 * A row's values for its copy in a duplicated database. In relations to that same database
 * (`sameDatabaseRelationIds`), links point to the copied rows (`idMap`: original row id → copy id)
 * and links to rows that weren't copied are dropped. Everything else, links to other databases
 * included, is copied as it is. Templates' preset values are copied the same way (This page stays).
 */
export function remapForDuplicate(
  values: Readonly<Partial<Record<Id, unknown>>>,
  idMap: ReadonlyMap<Id, Id>,
  sameDatabaseRelationIds: Iterable<Id>,
): Partial<Record<Id, unknown>> {
  const same = new Set(sameDatabaseRelationIds);
  const out: Partial<Record<Id, unknown>> = {};
  for (const [propertyId, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (!same.has(propertyId)) {
      out[propertyId] = copy(value);
      continue;
    }
    if (!Array.isArray(value)) continue;
    const links = value.flatMap((id: unknown) => {
      const to = id === THIS_PAGE ? id : typeof id === 'string' ? idMap.get(id) : undefined;
      return to === undefined ? [] : [to];
    });
    if (links.length) out[propertyId] = [...new Set(links)];
  }
  return out;
}

/** Splits a cell's links into the rows the viewer can open and a count of the others. */
export function visibleLinks(
  ids: readonly Id[] | null | undefined,
  canOpen: (rowId: Id) => boolean,
): { visible: Id[]; hiddenCount: number } {
  const visible: Id[] = [];
  let hiddenCount = 0;
  for (const id of ids ?? []) {
    if (canOpen(id)) visible.push(id);
    else hiddenCount++;
  }
  return { visible, hiddenCount };
}

/** "1 row you can't open", "3 rows you can't open"; "" for none. Shown with no titles. */
export function hiddenRowsLabel(n: number): string {
  if (n <= 0) return '';
  return n === 1 ? "1 row you can't open" : `${n} rows you can't open`;
}
