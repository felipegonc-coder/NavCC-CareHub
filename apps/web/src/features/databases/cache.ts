/**
 * Pure helpers that change cached answers: "Load more" pages, and the optimistic updates that show
 * a change before the server answers (rolled back if it refuses), options typed into cells included.
 */
import type { Id, Property, SelectOption } from '@carehub/databases';
import { findOptionByName } from '@carehub/databases/options';
import type { QueryGroup, QueryRow, ViewQueryData } from './contract';

/** What to ask the server for to load more of the view, a group or a board sub-group; null: nothing. */
export function moreRequest(
  data: ViewQueryData,
  groupKey?: string,
  subGroupKey?: string,
): { cursor: string } | { groupKey: string } | null {
  if (groupKey === undefined) return data.nextCursor ? { cursor: data.nextCursor } : null;
  const group = data.groups?.find((g) => g.key === groupKey);
  const holder =
    subGroupKey === undefined ? group : group?.subGroups?.find((s) => s.key === subGroupKey);
  if (!holder) return null;
  if (holder.nextCursor) return { cursor: holder.nextCursor };
  // Hidden groups come without rows until someone asks for them.
  if (subGroupKey === undefined && holder.rows.length === 0 && holder.count > 0) {
    return { groupKey };
  }
  return null;
}

function appendRows(rows: readonly QueryRow[], more: readonly QueryRow[]): QueryRow[] {
  const seen = new Set(rows.map((r) => r.id));
  return [...rows, ...more.filter((r) => !seen.has(r.id))];
}

function continueGroup(group: QueryGroup, answer: QueryGroup | undefined): QueryGroup {
  if (!answer) return { ...group, nextCursor: null };
  return { ...group, rows: appendRows(group.rows, answer.rows), nextCursor: answer.nextCursor };
}

/**
 * Adds a "Load more" answer (`continued`) to what is shown. A group or sub-group missing from the
 * answer is gone: it stops offering more.
 */
export function mergeMore(
  data: ViewQueryData,
  page: ViewQueryData,
  groupKey?: string,
  subGroupKey?: string,
): ViewQueryData {
  const rowTitles = { ...data.rowTitles, ...page.rowTitles };
  const named = data.people || page.people ? { people: { ...data.people, ...page.people } } : {};
  if (groupKey === undefined) {
    return {
      ...data,
      ...named,
      rowTitles,
      rows: appendRows(data.rows, page.rows),
      nextCursor: page.nextCursor,
    };
  }
  const answer = page.groups?.find((g) => g.key === groupKey);
  const groups = data.groups?.map((group) => {
    if (group.key !== groupKey) return group;
    if (subGroupKey === undefined) return continueGroup(group, answer);
    const sub = answer?.subGroups?.find((s) => s.key === subGroupKey);
    return {
      ...group,
      subGroups: group.subGroups?.map((s) => (s.key === subGroupKey ? continueGroup(s, sub) : s)),
    };
  });
  return { ...data, ...named, rowTitles, groups: groups ?? null };
}

/** Changes or removes (null) rows wherever they show, keeping counts right. */
export function mapQueryRows(
  data: ViewQueryData,
  change: (row: QueryRow) => QueryRow | null,
): ViewQueryData {
  const removed = new Set<Id>();
  const list = (rows: readonly QueryRow[]): [QueryRow[], number] => {
    const out: QueryRow[] = [];
    let gone = 0;
    for (const row of rows) {
      const next = change(row);
      if (next) out.push(next);
      else {
        gone += 1;
        removed.add(row.id);
      }
    }
    return [out, gone];
  };
  const group = (g: QueryGroup): QueryGroup => {
    const [rows, gone] = list(g.rows);
    let count = g.count - gone;
    const subGroups = g.subGroups?.map((s) => {
      const next = group(s);
      count -= s.count - next.count;
      return next;
    });
    return subGroups ? { ...g, rows, count, subGroups } : { ...g, rows, count };
  };
  const [rows] = list(data.rows);
  const groups = data.groups?.map(group) ?? null;
  return { ...data, rows, groups, count: data.count - removed.size };
}

/** The Name property, whose value is the row's title. */
export function titlePropertyId(properties: readonly Property[]): Id | undefined {
  return properties.find((p) => p.config.type === 'title')?.id;
}

/** A row with changed values. The Name property's value goes to the title; null clears a value. */
export function withValues<R extends { title: string; values: Partial<Record<Id, unknown>> }>(
  row: R,
  values: Partial<Record<Id, unknown>>,
  titleId: Id | undefined,
): R {
  let title = row.title;
  const next: Partial<Record<Id, unknown>> = { ...row.values };
  for (const [id, value] of Object.entries(values)) {
    if (id === titleId) title = typeof value === 'string' ? value : '';
    else next[id] = value ?? null;
  }
  return { ...row, title, values: next };
}

/** Where a moved row lands in a cached answer. */
export interface CachePlace {
  beforeRowId?: Id | null;
  /** Grouped views: the group (and lane) it leaves; absent: wherever it shows. */
  fromGroupKey?: string;
  fromSubGroupKey?: string;
  /** Grouped views: the group it lands in. Boards with sub-groups need the lane too. */
  toGroupKey?: string;
  toSubGroupKey?: string;
}

/** A loaded row, wherever it shows (rows, groups or sub-groups). */
export function findQueryRow(data: ViewQueryData, rowId: Id): QueryRow | undefined {
  const lists = [
    data.rows,
    ...(data.groups ?? []).flatMap((g) => [g.rows, ...(g.subGroups ?? []).map((s) => s.rows)]),
  ];
  for (const rows of lists) {
    const row = rows.find((r) => r.id === rowId);
    if (row) return row;
  }
  return undefined;
}

function insertBefore(rows: readonly QueryRow[], row: QueryRow, beforeRowId?: Id | null) {
  const at = beforeRowId ? rows.findIndex((r) => r.id === beforeRowId) : -1;
  return at < 0 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)];
}

function takeOut(group: QueryGroup, rowId: Id, subGroupKey: string | undefined): QueryGroup {
  const drop = (g: QueryGroup): QueryGroup =>
    g.rows.some((r) => r.id === rowId)
      ? { ...g, count: g.count - 1, rows: g.rows.filter((r) => r.id !== rowId) }
      : g;
  if (!group.subGroups) return drop(group);
  let removed = 0;
  const subGroups = group.subGroups.map((s) => {
    if (subGroupKey !== undefined && s.key !== subGroupKey) return s;
    const next = drop(s);
    if (next !== s) removed += 1;
    return next;
  });
  return removed ? { ...group, count: group.count - removed, subGroups } : group;
}

function putIn(
  group: QueryGroup,
  row: QueryRow,
  subGroupKey: string | undefined,
  beforeRowId: Id | null | undefined,
): QueryGroup {
  const add = (g: QueryGroup): QueryGroup => ({
    ...g,
    count: g.count + 1,
    rows: insertBefore(g.rows, row, beforeRowId),
  });
  if (subGroupKey === undefined || !group.subGroups) return add(group);
  return {
    ...group,
    count: group.count + 1,
    subGroups: group.subGroups.map((s) => (s.key === subGroupKey ? add(s) : s)),
  };
}

/**
 * Moves a row in a cached answer: out of where it is and into the place given (before a row, or at
 * the end). Leaves the answer alone when the row or the place isn't loaded.
 */
export function moveInCache(data: ViewQueryData, rowId: Id, place: CachePlace): ViewQueryData {
  const row = findQueryRow(data, rowId);
  if (!row) return data;
  if (!data.groups) {
    const rest = data.rows.filter((r) => r.id !== rowId);
    return { ...data, rows: insertBefore(rest, row, place.beforeRowId) };
  }
  const target = data.groups.find((g) => g.key === place.toGroupKey);
  if (!target) return data;
  if (target.subGroups && !target.subGroups.some((s) => s.key === place.toSubGroupKey)) {
    return data;
  }
  const groups = data.groups.map((g) => {
    const leaving = place.fromGroupKey === undefined || g.key === place.fromGroupKey;
    const next = leaving ? takeOut(g, rowId, place.fromSubGroupKey) : g;
    return g.key === place.toGroupKey
      ? putIn(next, row, place.toSubGroupKey, place.beforeRowId)
      : next;
  });
  return { ...data, groups };
}

// ---------------------------------------------------------------- options typed into cells

/**
 * The database with new options added to a Select or Multi-select property, in the order given,
 * leaving out any whose id or name (ignoring case) the property already has.
 */
export function withTypedOptions<M extends { properties: Property[] }>(
  meta: M,
  propertyId: Id,
  typed: readonly SelectOption[],
): M {
  let changed = false;
  const properties = meta.properties.map((property) => {
    const config = property.config;
    if (property.id !== propertyId) return property;
    if (config.type !== 'select' && config.type !== 'multi_select') return property;
    const options = [...config.options];
    for (const option of typed) {
      const known = options.some((o) => o.id === option.id);
      if (!known && !findOptionByName(options, option.name)) options.push(option);
    }
    if (options.length === config.options.length) return property;
    changed = true;
    return { ...property, config: { ...config, options } };
  });
  return changed ? { ...meta, properties } : meta;
}

/**
 * The id to save for each new option once the property has them (as the server answered): its
 * own, or the id of the option of the same name the property had already.
 */
export function savedOptionIds(
  property: Property | undefined,
  typed: readonly SelectOption[],
): Record<Id, Id> {
  const config = property?.config;
  const options = config?.type === 'select' || config?.type === 'multi_select' ? config.options : [];
  const ids: Record<Id, Id> = {};
  for (const option of typed) {
    const known = options.some((o) => o.id === option.id);
    ids[option.id] = known ? option.id : (findOptionByName(options, option.name)?.id ?? option.id);
  }
  return ids;
}

/** A Select or Multi-select value with option ids swapped as savedOptionIds says. */
export function withOptionIds(value: unknown, ids: Readonly<Record<Id, Id>>): unknown {
  const swap = (id: unknown) => (typeof id === 'string' ? (ids[id] ?? id) : id);
  return Array.isArray(value) ? [...new Set(value.map(swap))] : swap(value);
}
