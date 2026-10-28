import type { Id } from '@carehub/databases';

/** The rows ticked in the table, and where a Shift-click or Shift+arrow range starts. */
export interface RowSelection {
  ids: ReadonlySet<Id>;
  /** The line ticked or unticked last (a line key: a row can sit in several groups). */
  anchor: string | null;
  /** The ticks from before the Shift+arrow range from the anchor. */
  base: ReadonlySet<Id>;
  /** Where the last Shift+arrow range ended: the next one from there carries on. */
  end: string | null;
}

/** A line on screen, as selection needs it. */
export interface SelectableLine {
  key: string;
  row: { id: Id };
}

const NONE: ReadonlySet<Id> = new Set();
export const NO_SELECTION: RowSelection = { ids: NONE, anchor: null, base: NONE, end: null };

/**
 * Ticks or unticks one line's row. With `range` (Shift-click) every row from the anchor to it
 * gets the same tick, as long as the anchor is still on screen.
 */
export function tick(
  selection: RowSelection,
  lines: readonly SelectableLine[],
  lineKey: string,
  range: boolean,
): RowSelection {
  const at = lines.findIndex((l) => l.key === lineKey);
  const line = lines[at];
  if (!line) return selection;
  const on = !selection.ids.has(line.row.id);
  const from =
    range && selection.anchor !== null ? lines.findIndex((l) => l.key === selection.anchor) : -1;
  const picked = from < 0 ? [line] : lines.slice(Math.min(from, at), Math.max(from, at) + 1);
  const ids = new Set(selection.ids);
  for (const l of picked) {
    if (on) ids.add(l.row.id);
    else ids.delete(l.row.id);
  }
  return { ids, anchor: lineKey, base: ids, end: null };
}

/**
 * Shift+arrows in the selection column, moving from `fromKey` to `toKey`: the ticks from before,
 * plus every row from where the range started. Moving back shrinks the range again.
 */
export function extendTo(
  selection: RowSelection,
  lines: readonly SelectableLine[],
  fromKey: string,
  toKey: string,
): RowSelection {
  const carryOn =
    selection.end === fromKey &&
    selection.anchor !== null &&
    lines.some((l) => l.key === selection.anchor);
  const anchor = carryOn && selection.anchor !== null ? selection.anchor : fromKey;
  const base = carryOn ? selection.base : selection.ids;
  const from = lines.findIndex((l) => l.key === anchor);
  const to = lines.findIndex((l) => l.key === toKey);
  if (from < 0 || to < 0) return selection;
  const ids = new Set(base);
  for (const l of lines.slice(Math.min(from, to), Math.max(from, to) + 1)) ids.add(l.row.id);
  return { ids, anchor, base, end: toKey };
}

/** Every row on screen ticked. */
export function selectAll(lines: readonly SelectableLine[]): RowSelection {
  const ids = new Set(lines.map((l) => l.row.id));
  return { ids, anchor: null, base: ids, end: null };
}

/** The ticked rows that are still in the answer (rows that went to Trash or left drop out). */
export function selectedNow(selection: RowSelection, present: ReadonlySet<Id>): ReadonlySet<Id> {
  const ids = [...selection.ids].filter((id) => present.has(id));
  return ids.length === selection.ids.size ? selection.ids : new Set(ids);
}

/** The header's tick: all, some ("indeterminate") or none of the rows on screen. */
export function allTicked(
  lines: readonly SelectableLine[],
  ids: ReadonlySet<Id>,
): boolean | 'indeterminate' {
  if (lines.length === 0 || ids.size === 0) return false;
  const ticked = lines.filter((l) => ids.has(l.row.id)).length;
  if (ticked === lines.length) return true;
  return ticked > 0 ? 'indeterminate' : false;
}
