/**
 * The board's plain logic: its columns and lanes, what a card shows, where a card may move and
 * where it lands. No React, so it's tested on its own.
 */
import {
  EMPTY_GROUP,
  type CardPreview,
  type EvalContext,
  type FileRef,
  type Grouping,
  type Id,
  type Property,
  type Row,
  type View,
} from '@carehub/databases';
import { groupMovePatch } from '@carehub/databases/group';
import { breakpoints } from '@carehub/ui';
import type { CellData } from '../cells';
import {
  fileUrl,
  loadMoreKey,
  type QueryGroup,
  type QueryLane,
  type QueryRow,
  type RowPlace,
  type ViewQueryData,
} from '../contract';
import { moveValues } from '../shell/moves';

/** Phones (below the design kit's md breakpoint): the board shows one column at a time. */
export const PHONE = `not all and (min-width: ${breakpoints.md})`;

/** Where a card sits: a column, and its lane on a board with sub-groups. */
export interface Slot {
  groupKey: string;
  laneKey?: string;
}

/** Names a slot; the same as its "Load more" key. */
export const slotKey = (slot: Slot): string => loadMoreKey(slot.groupKey, slot.laneKey);

export const sameSlot = (a: Slot, b: Slot): boolean =>
  a.groupKey === b.groupKey && a.laneKey === b.laneKey;

/** One slot's part of the answer. */
export interface SlotRows {
  rows: readonly QueryRow[];
  count: number;
  nextCursor: string | null;
}

const NO_ROWS: SlotRows = { rows: [], count: 0, nextCursor: null };

/** The rows of a column, or of a column's part of a lane. */
export function slotRows(group: QueryGroup, laneKey?: string): SlotRows {
  if (laneKey === undefined) return group;
  return group.subGroups?.find((sub) => sub.key === laneKey) ?? NO_ROWS;
}

/** Whether a group or lane is left out: "Hide empty groups" is on and it has no rows. */
const leftOut = (group: { count: number }, grouping: Grouping | null | undefined) =>
  grouping?.hideEmpty === true && group.count === 0;

/** The groups a list or gallery shows: not hidden, and not empty with "Hide empty groups". */
export const shownGroups = (
  groups: readonly QueryGroup[],
  grouping: Grouping | null | undefined,
): QueryGroup[] => groups.filter((g) => !g.hidden && !leftOut(g, grouping));

/** The columns in the view's order, and the hidden ones (listed under "Hidden groups"). */
export function boardColumns(
  groups: readonly QueryGroup[] | null,
  grouping?: Grouping | null,
): {
  shown: QueryGroup[];
  hidden: QueryGroup[];
} {
  const all = (groups ?? []).filter((g) => !leftOut(g, grouping));
  return { shown: all.filter((g) => !g.hidden), hidden: all.filter((g) => g.hidden) };
}

/** The lanes shown, or null on a board without sub-groups. */
export const boardLanes = (
  lanes: readonly QueryLane[] | null,
  subGrouping?: Grouping | null,
): QueryLane[] | null =>
  lanes ? lanes.filter((lane) => !lane.hidden && !leftOut(lane, subGrouping)) : null;

/** The grouping without one hidden group: "Show" in the Hidden groups list. */
export function withGroupShown(grouping: Grouping, groupKey: string): Grouping {
  return { ...grouping, hidden: (grouping.hidden ?? []).filter((key) => key !== groupKey) };
}

/** A row the server made, drawn by the board until the answer has it. */
export function asQueryRow(row: Row): QueryRow {
  return {
    id: row.id,
    title: row.title,
    icon: row.icon ?? null,
    formId: row.formId ?? null,
    values: row.values,
    computed: {},
    hiddenLinks: {},
    color: { row: null, cells: {} },
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    editedAt: row.editedAt,
    editedBy: row.editedBy,
    uniqueNumber: row.uniqueNumber,
  };
}

/** Whether the answer has a row, in any column or lane. */
export function inAnswer(data: Pick<ViewQueryData, 'rows' | 'groups'>, rowId: Id): boolean {
  const has = (rows: readonly QueryRow[]) => rows.some((r) => r.id === rowId);
  return (
    has(data.rows) ||
    (data.groups ?? []).some((g) => has(g.rows) || (g.subGroups ?? []).some((s) => has(s.rows)))
  );
}

// ---------------------------------------------------------------- cards

/** The properties cards show: the view's visible ones in its order, without the title. */
export function cardProperties(
  view: Pick<View, 'properties'>,
  properties: readonly Property[],
  visibleIds: readonly Id[],
): Property[] {
  const seen = new Set(visibleIds);
  const byId = new Map(properties.map((p) => [p.id, p]));
  return view.properties.flatMap((setting) => {
    const property =
      setting.visible && seen.has(setting.propertyId) && byId.get(setting.propertyId);
    return property && property.config.type !== 'title' && property.config.type !== 'button'
      ? [property]
      : [];
  });
}

/** Whether a card has something to show for a property (a checkbox always does). */
export function hasValue(property: Property, cell: CellData): boolean {
  if (property.config.type === 'checkbox') return true;
  const { value, computed } = cell;
  if (computed) {
    if (computed.kind === 'empty') return false;
    if (computed.kind === 'text') return computed.value !== '';
    if (computed.kind === 'list') return computed.value.length > 0;
    return true;
  }
  if (value === null || value === undefined || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

/** A picture on a card. */
export interface CardPicture {
  src: string;
  name: string;
}

/**
 * What a row may carry for the "Page cover" and "Page content" previews. The answer leaves them
 * out until the server sends them; the cards show them as soon as it does.
 */
interface PreviewFields {
  cover?: FileRef | null;
  contentPicture?: FileRef | null;
}

const PICTURE_NAME = /\.(?:apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i;

function isFileRef(value: unknown): value is FileRef {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Partial<Record<keyof FileRef, unknown>>;
  return typeof file.id === 'string' && typeof file.name === 'string';
}

/** An upload with a picture type, or a web link whose address ends in a picture's name. */
export function isPicture(file: FileRef): boolean {
  if (typeof file.mime === 'string' && file.mime.startsWith('image/')) return true;
  const address = file.url?.split(/[?#]/)[0] ?? '';
  return PICTURE_NAME.test(address);
}

function pictureOf(file: unknown): CardPicture | null {
  if (!isFileRef(file) || !isPicture(file)) return null;
  return { src: file.url ?? fileUrl(file), name: file.name };
}

/** The picture a card shows for the view's card preview, or null. */
export function cardPicture(row: QueryRow, preview: CardPreview): CardPicture | null {
  const fields = row as QueryRow & PreviewFields;
  switch (preview.kind) {
    case 'none':
      return null;
    case 'cover':
      return pictureOf(fields.cover);
    case 'content':
      return pictureOf(fields.contentPicture);
    case 'files': {
      const files = row.values[preview.propertyId];
      if (!Array.isArray(files)) return null;
      for (const file of files) {
        const picture = pictureOf(file);
        if (picture) return picture;
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------- moves

/** The place a move asks the shell for. */
export function rowPlace(from: Slot, to: Slot, beforeRowId: Id | null): RowPlace {
  const place: RowPlace = { beforeRowId, fromGroupKey: from.groupKey, toGroupKey: to.groupKey };
  if (from.laneKey !== undefined && to.laneKey !== undefined) {
    place.fromSubGroupKey = from.laneKey;
    place.toSubGroupKey = to.laneKey;
  }
  return place;
}

/** Whether a card can go to a slot: its own, or one whose value the shell can write. */
export function canMoveTo(
  row: QueryRow,
  view: Pick<View, 'grouping' | 'subGrouping'>,
  from: Slot,
  to: Slot,
  ctx: EvalContext,
): boolean {
  return sameSlot(from, to) || moveValues(row, view, rowPlace(from, to, null), ctx) !== null;
}

/** The row a card lands before at `index` among the slot's other cards; null: the end. */
export function beforeRowAt(rows: readonly QueryRow[], rowId: Id, index: number): Id | null {
  return rows.filter((r) => r.id !== rowId)[index]?.id ?? null;
}

/**
 * The values a new card made in a lane starts with: the lane's (the server sets the column's from
 * the group key). Empty for "No value" lanes, and for lanes that can't set one.
 */
export function laneValues(
  view: Pick<View, 'subGrouping'>,
  laneKey: string | undefined,
  ctx: EvalContext,
): Partial<Record<Id, unknown>> | undefined {
  if (!view.subGrouping || laneKey === undefined || laneKey === EMPTY_GROUP) return undefined;
  const blank: Row = {
    id: '',
    title: '',
    values: {},
    createdAt: '',
    createdBy: null,
    editedAt: '',
    editedBy: null,
    uniqueNumber: null,
  };
  const patch = groupMovePatch(blank, view.subGrouping, EMPTY_GROUP, laneKey, ctx);
  return patch ? { [patch.propertyId]: patch.value } : undefined;
}

// ---------------------------------------------------------------- keyboard moves

/** A card picked up with Space: where it was, and where it would land now. */
export interface Picked {
  rowId: Id;
  from: Slot;
  fromIndex: number;
  to: Slot;
  /** Among the other cards of `to`. */
  index: number;
}

export type Arrow = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export const isArrow = (key: string): key is Arrow =>
  key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';

/** What a keyboard move needs to know about the board. */
export interface BoardGrid {
  /** Column group keys, left to right. */
  columns: readonly string[];
  /** Lane keys, top to bottom; [undefined] without sub-groups. */
  lanes: readonly (string | undefined)[];
  /** The cards loaded in a slot. */
  rowsIn(slot: Slot): readonly QueryRow[];
  /** Whether the picked card may go there. */
  allowed(slot: Slot): boolean;
}

const othersIn = (grid: Pick<BoardGrid, 'rowsIn'>, slot: Slot, rowId: Id) =>
  grid.rowsIn(slot).filter((r) => r.id !== rowId).length;

/**
 * Where an arrow key takes a picked-up card: up and down within the column (then into the lane
 * above or below), left and right to the nearest column that can take it. Null: no further.
 */
export function stepPicked(picked: Picked, arrow: Arrow, grid: BoardGrid): Picked | null {
  const { to, index, rowId } = picked;
  if (arrow === 'ArrowUp' && index > 0) return { ...picked, index: index - 1 };
  if (arrow === 'ArrowDown' && index < othersIn(grid, to, rowId))
    return { ...picked, index: index + 1 };
  const lane = grid.lanes.indexOf(to.laneKey);
  const column = grid.columns.indexOf(to.groupKey);
  const vertical = arrow === 'ArrowUp' || arrow === 'ArrowDown';
  const step = arrow === 'ArrowUp' || arrow === 'ArrowLeft' ? -1 : 1;
  for (let at = (vertical ? lane : column) + step; ; at += step) {
    const slot: Slot | null = vertical
      ? at >= 0 && at < grid.lanes.length
        ? withLane(to.groupKey, grid.lanes[at])
        : null
      : at >= 0 && at < grid.columns.length
        ? withLane(grid.columns[at] ?? '', to.laneKey)
        : null;
    if (!slot) return null;
    if (!grid.allowed(slot)) continue;
    const count = othersIn(grid, slot, rowId);
    const landing = vertical ? (step < 0 ? count : 0) : Math.min(index, count);
    return { ...picked, to: slot, index: landing };
  }
}

function withLane(groupKey: string, laneKey: string | undefined): Slot {
  return laneKey === undefined ? { groupKey } : { groupKey, laneKey };
}

/** Whether dropping the picked card where it is now changes anything. */
export const pickedMoved = (picked: Picked): boolean =>
  !sameSlot(picked.from, picked.to) || picked.index !== picked.fromIndex;

/** What a keyboard move needs to know about a list or a gallery: its groups, top to bottom. */
export interface LineGrid {
  /** Group keys in order; [''] without a grouping. */
  slots: readonly string[];
  /** Cards on one line of the grid (1 in a list). */
  perLine: number;
  /** Whether ← and → move a card too (a gallery's grid). */
  sideways: boolean;
  rowsIn(slot: Slot): readonly QueryRow[];
  allowed(slot: Slot): boolean;
}

/**
 * Where an arrow key takes a picked-up card in a list or gallery: ← and → one place, ↑ and ↓ one
 * line, then on into the group before or after that can take it. Null: no further.
 */
export function stepAlong(picked: Picked, arrow: Arrow, grid: LineGrid): Picked | null {
  const { to, index, rowId } = picked;
  const sideways = arrow === 'ArrowLeft' || arrow === 'ArrowRight';
  if (sideways && !grid.sideways) return null;
  const distance = sideways ? 1 : Math.max(1, grid.perLine);
  const back = arrow === 'ArrowUp' || arrow === 'ArrowLeft';
  const count = othersIn(grid, to, rowId);
  if (back && index - distance >= 0) return { ...picked, index: index - distance };
  if (!back && index + distance <= count) return { ...picked, index: index + distance };
  const step = back ? -1 : 1;
  for (
    let at = grid.slots.indexOf(to.groupKey) + step;
    at >= 0 && at < grid.slots.length;
    at += step
  ) {
    const slot: Slot = { groupKey: grid.slots[at] ?? '' };
    if (!grid.allowed(slot)) continue;
    return { ...picked, to: slot, index: back ? othersIn(grid, slot, rowId) : 0 };
  }
  return null;
}
