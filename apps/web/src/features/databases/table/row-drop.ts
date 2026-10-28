import type { Id } from '@carehub/databases';

/** A row on screen, px from the table's top edge. */
export interface MeasuredRow {
  rowId: Id;
  top: number;
  bottom: number;
  /** false: a dragged row can't land right before it (sub-items in a nested view). */
  place?: boolean;
}

/** The whole list or one group as drawn, px from the table's top edge (header to last button). */
export interface MeasuredSection {
  key: string;
  top: number;
  bottom: number;
  /** Its rows on screen, in order; none while it's collapsed. */
  rows: readonly MeasuredRow[];
  /** More rows come after the loaded ones ("Load more"), so its end isn't a place on screen. */
  more: boolean;
}

/** Where a moved row goes: before a row of the section, or at its end (null). */
export interface RowTarget {
  sectionKey: string;
  beforeRowId: Id | null;
}

/** What shows where a dragged row would land: a line between rows, or a box around a group. */
export type DropMark = { kind: 'line'; y: number } | { kind: 'box'; top: number; bottom: number };

export interface RowDrop extends RowTarget {
  mark: DropMark;
}

/**
 * Where a row dragged to `y` (px from the table's top edge) lands. In manual order it goes
 * between the two rows nearest the pointer. In a sorted view, or a group with no rows on screen,
 * it goes into the group (sorted views only change groups).
 */
export function rowDropAt(
  sections: readonly MeasuredSection[],
  y: number,
  manual: boolean,
): RowDrop | null {
  const first = sections[0];
  const last = sections.at(-1);
  if (!first || !last) return null;
  const section =
    sections.find((s) => y >= s.top && y < s.bottom) ?? (y < first.top ? first : last);
  const rows = section.rows;
  const before = rows.filter((r) => r.place !== false);
  if (!manual || before.length === 0) {
    return {
      sectionKey: section.key,
      beforeRowId: null,
      mark: { kind: 'box', top: section.top, bottom: section.bottom },
    };
  }
  const places: { beforeRowId: Id | null; y: number }[] = before.map((r) => ({
    beforeRowId: r.rowId,
    y: r.top,
  }));
  const end = rows.at(-1);
  if (end && !section.more) places.push({ beforeRowId: null, y: end.bottom });
  let best = places[0];
  for (const place of places) {
    if (best === undefined || Math.abs(place.y - y) < Math.abs(best.y - y)) best = place;
  }
  if (!best) return null;
  return {
    sectionKey: section.key,
    beforeRowId: best.beforeRowId,
    mark: { kind: 'line', y: best.y },
  };
}

/**
 * Whether moving the row there changes nothing: the same group, and in manual order right
 * before itself or the row after it. `rowIds` are its section's rows in order.
 */
export function samePlace(
  target: RowTarget,
  fromKey: string,
  rowIds: readonly Id[],
  rowId: Id,
  manual: boolean,
): boolean {
  if (target.sectionKey !== fromKey) return false;
  if (!manual) return true;
  const at = rowIds.indexOf(rowId);
  if (at < 0) return false;
  return target.beforeRowId === rowId || target.beforeRowId === (rowIds[at + 1] ?? null);
}

/**
 * Move up (-1) or Move down (1) one place in manual order: the row it then goes before (null: the
 * end), or undefined when it can't (the first or last row, or the last loaded one before "Load
 * more").
 */
export function stepPlace(
  rowIds: readonly Id[],
  rowId: Id,
  step: 1 | -1,
  more: boolean,
): Id | null | undefined {
  const at = rowIds.indexOf(rowId);
  if (at < 0) return undefined;
  if (step === -1) return at > 0 ? rowIds[at - 1] : undefined;
  if (at >= rowIds.length - 1) return undefined;
  return rowIds[at + 2] ?? (more ? undefined : null);
}
