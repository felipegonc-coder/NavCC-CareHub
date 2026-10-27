/**
 * What dragging a row to another group or lane writes (spec: Board), from the engine's rules.
 * Plain functions, so they're tested without React.
 */
import type { EvalContext, Grouping, Row, View } from '@carehub/databases';
import { groupMovePatch } from '@carehub/databases/group';
import type { RowValues } from '../api';
import type { QueryRow, RowPlace } from '../contract';

/** A row from a query answer in the shape the engine's row rules read. */
export function storedRow(row: QueryRow): Row {
  return {
    id: row.id,
    title: row.title,
    values: row.values,
    createdAt: row.createdAt ?? '',
    createdBy: row.createdBy,
    editedAt: row.editedAt ?? '',
    editedBy: row.editedBy,
    uniqueNumber: row.uniqueNumber,
    icon: row.icon,
    formId: row.formId,
  };
}

/**
 * The values that put a row in the groups it's dragged to, or null when a group can't set its
 * value (dates, formulas, "Rows you can't open"...).
 */
export function moveValues(
  row: QueryRow | undefined,
  view: Pick<View, 'grouping' | 'subGrouping'>,
  place: RowPlace,
  ctx: EvalContext,
): RowValues | null {
  const values: RowValues = {};
  const steps: [Grouping | null, string | undefined, string | undefined][] = [
    [view.grouping, place.fromGroupKey, place.toGroupKey],
    [view.subGrouping, place.fromSubGroupKey, place.toSubGroupKey],
  ];
  for (const [grouping, from, to] of steps) {
    if (!grouping || from === undefined || to === undefined || from === to) continue;
    const patch = row ? groupMovePatch(storedRow(row), grouping, from, to, ctx) : null;
    if (!patch) return null;
    values[patch.propertyId] = patch.value;
  }
  return values;
}
