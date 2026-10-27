/**
 * Dependencies (Databases spec 3.13): "Blocked by" and "Blocking" relations between rows of one
 * database, the arrows timelines draw, loop checks, and the dates that shift when a blocking row
 * moves later.
 *
 * Pure functions: rows and settings in; arrows, messages and date changes out. Only the rows passed
 * in are read or changed (rows that aren't there are never shifted or mentioned); the server checks
 * access again before saving.
 */
import {
  DEFAULT_TIME_ZONE,
  addDays,
  daysBetween,
  isValidDateValue,
  isValidTimeZone,
  startOfDayInstant,
} from './dates';
import { LOOP_MESSAGE } from './hierarchy';
import type { RelationEdit } from './hierarchy';
import { LIMITS } from './types';
import type { CalendarDate, DatabaseMeta, DateValue, Id, Row } from './types';

export { LOOP_MESSAGE };

/** The database's dependency relations and shift mode (DatabaseMeta.dependencies while on). */
export type DependencySettings = NonNullable<DatabaseMeta['dependencies']>;

/** Said when one move would shift more than LIMITS.dependencyShiftRows rows. */
export const SHIFT_LIMIT_MESSAGE = `Only ${LIMITS.dependencyShiftRows} rows can shift at once, so some blocked rows didn't move.`;

/**
 * Where rows' dates come from (a timeline's Show by, and its separate end property if any), and the
 * time zone that places dates without a time on the time line (the viewer's).
 */
export interface DependencyDates {
  startPropertyId: Id;
  /** A separate end-date property; null: the start property holds the whole range. */
  endPropertyId: Id | null;
  timeZone: string;
}

/** One arrow on a timeline, from a blocking row to a row it blocks. */
export interface DependencyArrow {
  fromId: Id;
  toId: Id;
  /** The blocked row starts before the blocking row ends: the arrow is red. */
  conflict: boolean;
}

/** A row's dates changing: its new values for the date properties (one left out keeps its value). */
export interface DateMove {
  rowId: Id;
  values: Partial<Record<Id, DateValue | null>>;
}

/** A date value to save on a row that shifts. */
export interface DateShift {
  rowId: Id;
  propertyId: Id;
  value: DateValue;
}

/** What a move shifts. */
export interface ShiftPlan {
  /** Values to save along with the move, in the order the rows were reached. Empty: nothing shifts. */
  changes: DateShift[];
  /** SHIFT_LIMIT_MESSAGE when more rows would have shifted than the limit; otherwise null. */
  message: string | null;
}

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1_440;

/** Where a row sits on the time line. */
interface Span {
  /** Start in ms since 1970 (a date without a time: the first moment of its day). */
  start: number;
  /** End in ms (a date without a time: the first moment of the day after its last day). */
  end: number;
  /** The last day, when the end has no time. */
  endDay: CalendarDate | null;
}

function links(row: Row, propertyId: Id): Id[] {
  const v = row.values[propertyId];
  return Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string' && x !== '') : [];
}

function uniqueRows(rows: readonly Row[]): Row[] {
  const seen = new Set<Id>();
  const out: Row[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function addTo(map: Map<Id, Set<Id>>, key: Id, item: Id): void {
  const set = map.get(key);
  if (set) set.add(item);
  else map.set(key, new Set([item]));
}

function dateAt(values: Row['values'], propertyId: Id): DateValue | null {
  const v = values[propertyId];
  return isValidDateValue(v) ? v : null;
}

function zoneOf(dates: DependencyDates): string {
  return isValidTimeZone(dates.timeZone) ? dates.timeZone : DEFAULT_TIME_ZONE;
}

function spanOf(values: Row['values'], dates: DependencyDates, timeZone: string): Span | null {
  const first = dateAt(values, dates.startPropertyId);
  if (!first) return null;
  const last = (dates.endPropertyId ? dateAt(values, dates.endPropertyId) : null) ?? first;
  const endPoint = last.end ?? last.start;
  const dayStart = (day: CalendarDate) => Date.parse(startOfDayInstant(day, timeZone));
  return {
    start: first.hasTime ? Date.parse(first.start) : dayStart(first.start),
    end: last.hasTime ? Date.parse(endPoint) : dayStart(addDays(endPoint, 1)),
    endDay: last.hasTime ? null : endPoint,
  };
}

/** Blocking row → the rows it blocks, among `list` only, read from both relations. */
function blockGraph(list: readonly Row[], settings: DependencySettings): Map<Id, Set<Id>> {
  const ids = new Set(list.map((r) => r.id));
  const out = new Map<Id, Set<Id>>();
  const link = (from: Id, to: Id) => {
    if (from !== to && ids.has(from) && ids.has(to)) addTo(out, from, to);
  };
  for (const row of list)
    for (const id of links(row, settings.blockingPropertyId)) link(row.id, id);
  for (const row of list)
    for (const id of links(row, settings.blockedByPropertyId)) link(id, row.id);
  return out;
}

/** Whether `target` can be reached from `start` by following the edges. */
function reaches(out: ReadonlyMap<Id, ReadonlySet<Id>>, start: Id, target: Id): boolean {
  const seen = new Set<Id>([start]);
  const stack = [start];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (id === target) return true;
    for (const next of out.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/**
 * The arrows a timeline draws between `rows`: one per blocking pair, read from both relations, in
 * row order. Links to rows that aren't in `rows` are left out. An arrow is a conflict (red) when
 * the blocked row starts before the blocking row ends; rows without dates never conflict.
 */
export function dependencyArrows(
  rows: readonly Row[],
  settings: DependencySettings,
  dates: DependencyDates,
): DependencyArrow[] {
  const list = uniqueRows(rows);
  const timeZone = zoneOf(dates);
  const spans = new Map(list.map((r) => [r.id, spanOf(r.values, dates, timeZone)]));
  const graph = blockGraph(list, settings);
  const arrows: DependencyArrow[] = [];
  for (const row of list) {
    for (const toId of graph.get(row.id) ?? []) {
      const from = spans.get(row.id);
      const to = spans.get(toId);
      arrows.push({ fromId: row.id, toId, conflict: !!from && !!to && to.start < from.end });
    }
  }
  return arrows;
}

/**
 * Checks a save that changes Blocked by or Blocking cells, of one row or many, before it's made:
 * LOOP_MESSAGE when a row would end up blocking itself, directly or through other rows; otherwise
 * null. A new value replaces the row's links on that side (the two-way partner follows). Edits to
 * other properties are ignored. The server checks again with every row of the database.
 */
export function checkDependencyEdits(
  rows: readonly Row[],
  settings: DependencySettings,
  edits: readonly RelationEdit[],
): string | null {
  const out = new Map<Id, Set<Id>>();
  const into = new Map<Id, Set<Id>>();
  const link = (from: Id, to: Id) => {
    addTo(out, from, to);
    addTo(into, to, from);
  };
  const unlink = (from: Id, to: Id) => {
    out.get(from)?.delete(to);
    into.get(to)?.delete(from);
  };
  for (const row of uniqueRows(rows)) {
    for (const id of links(row, settings.blockingPropertyId)) link(row.id, id);
    for (const id of links(row, settings.blockedByPropertyId)) link(id, row.id);
  }
  const added: [Id, Id][] = [];
  for (const { rowId, propertyId, value } of edits) {
    const ids = (value ?? []).filter((id) => typeof id === 'string' && id !== '');
    let fresh: [Id, Id][];
    if (propertyId === settings.blockingPropertyId) {
      for (const to of [...(out.get(rowId) ?? [])]) unlink(rowId, to);
      fresh = ids.map((to): [Id, Id] => [rowId, to]);
    } else if (propertyId === settings.blockedByPropertyId) {
      for (const from of [...(into.get(rowId) ?? [])]) unlink(from, rowId);
      fresh = ids.map((from): [Id, Id] => [from, rowId]);
    } else continue;
    for (const [from, to] of fresh) link(from, to);
    added.push(...fresh);
  }
  for (const [from, to] of added) {
    if (!out.get(from)?.has(to)) continue;
    if (from === to || reaches(out, to, from)) return LOOP_MESSAGE;
  }
  return null;
}

/** A date value moved later by a number of minutes: whole days (rounded up) when it has no time. */
function shiftValue(v: DateValue, minutes: number): DateValue {
  if (!v.hasTime) {
    const days = Math.ceil(minutes / DAY_MINUTES);
    return {
      ...v,
      start: addDays(v.start, days),
      end: v.end === null ? null : addDays(v.end, days),
    };
  }
  const later = (s: string) => new Date(Date.parse(s) + minutes * MINUTE_MS).toISOString();
  return { ...v, start: later(v.start), end: v.end === null ? null : later(v.end) };
}

/**
 * The dates that shift when a row's dates change (`rows` as saved before the change; `move` holds
 * its new values). With Shift, when the row's end moves later and it now overlaps a row it blocks,
 * that row moves later by the same amount, keeping the gap and its length, and so on down the
 * chain (a row blocked by several moved rows takes the largest amount). Dates without a time move
 * by whole days, dates with a time by exact minutes. Rows without dates, rows that don't overlap,
 * and rows not in `rows` stay. Don't shift (or a move earlier) gives no changes. Stops after
 * LIMITS.dependencyShiftRows rows with SHIFT_LIMIT_MESSAGE. The moved row's own values aren't in
 * the result.
 */
export function planDependencyShift(
  rows: readonly Row[],
  settings: DependencySettings,
  dates: DependencyDates,
  move: DateMove,
): ShiftPlan {
  const none: ShiftPlan = { changes: [], message: null };
  const list = uniqueRows(rows);
  const byId = new Map(list.map((r) => [r.id, r]));
  const moved = byId.get(move.rowId);
  if (settings.shift !== 'shift' || !moved) return none;
  const timeZone = zoneOf(dates);
  const nextValues: Row['values'] = { ...moved.values };
  for (const [id, v] of Object.entries(move.values)) if (v !== undefined) nextValues[id] = v;
  const before = spanOf(moved.values, dates, timeZone);
  const after = spanOf(nextValues, dates, timeZone);
  if (!before || !after) return none;
  const amount =
    before.endDay && after.endDay
      ? daysBetween(before.endDay, after.endDay) * DAY_MINUTES
      : Math.ceil((after.end - before.end) / MINUTE_MS);
  if (amount <= 0) return none;

  // The rows reachable from the moved row, and how many of their blockers among them come first.
  const graph = blockGraph(list, settings);
  const reached = [moved.id];
  const seen = new Set(reached);
  for (const id of reached) {
    for (const next of graph.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      reached.push(next);
    }
  }
  const waiting = new Map<Id, number>();
  for (const id of reached) {
    for (const next of graph.get(id) ?? []) waiting.set(next, (waiting.get(next) ?? 0) + 1);
  }

  const props = [...new Set([dates.startPropertyId, dates.endPropertyId])].filter(
    (p): p is Id => !!p,
  );
  const spanNow = new Map<Id, Span>([[moved.id, after]]);
  const movedBy = new Map<Id, number>([[moved.id, amount]]);
  const push = new Map<Id, number>();
  const changes: DateShift[] = [];
  let shifted = 0;
  const ready = [moved.id];
  const done = new Set<Id>();
  for (const id of ready) {
    if (done.has(id)) continue;
    done.add(id);
    const row = byId.get(id);
    const need = push.get(id) ?? 0;
    if (row && id !== moved.id && need > 0) {
      if (shifted === LIMITS.dependencyShiftRows) return { changes, message: SHIFT_LIMIT_MESSAGE };
      shifted++;
      const values: Row['values'] = { ...row.values };
      for (const propertyId of props) {
        const v = dateAt(row.values, propertyId);
        if (!v) continue;
        const value = shiftValue(v, need);
        values[propertyId] = value;
        changes.push({ rowId: id, propertyId, value });
      }
      const shiftedSpan = spanOf(values, dates, timeZone);
      if (shiftedSpan) spanNow.set(id, shiftedSpan);
      const wholeDays = shiftedSpan?.endDay ? Math.ceil(need / DAY_MINUTES) * DAY_MINUTES : need;
      movedBy.set(id, wholeDays);
    }
    const by = movedBy.get(id) ?? 0;
    const span = spanNow.get(id);
    for (const next of graph.get(id) ?? []) {
      const target = by > 0 && span ? spanOf(byId.get(next)?.values ?? {}, dates, timeZone) : null;
      if (span && target && target.start < span.end)
        push.set(next, Math.max(push.get(next) ?? 0, by));
      const left = (waiting.get(next) ?? 1) - 1;
      waiting.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  return { changes, message: null };
}
