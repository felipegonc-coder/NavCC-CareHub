/**
 * Cells for every property type, for tables, boards, galleries, lists and row pages.
 *
 * - `CellView` shows a value the way the spec describes it for each type.
 * - `CellEditor` edits one. Enter saves, Escape leaves without saving, Tab and Shift+Tab save and
 *   say where to go next (`details.move`; the caller picks the cell), and a press outside saves.
 *   Key it by row and property: it reads `value` when it opens. It opens in a popover over the
 *   cell it's rendered in (or `anchor`); the caller closes it after `onCommit` or `onCancel` and
 *   puts focus back on the cell (or the next one).
 * - Values are in stored form (as readValue gives them; `rowCell` reads one from a view's
 *   answer); `onCommit` sends what validateValue returns, with `details.changed` false when
 *   nothing changed and `details.newOptions` for options typed into a Select or Multi-select.
 */
export { CellEditor } from './cell-editor';
export { CellView, RichTextView } from './cell-view';
export { CheckMark, FileChip, HiddenRowsChip, OptionChip, PersonChip, RowChip } from './chips';
export {
  CELL_TEXT,
  DAY_REMINDER_LABELS,
  STATUS_GROUP_LABELS,
  TIME_REMINDER_LABELS,
} from './messages';
export { rowCell, type CellData } from './row-cell';
export type {
  CellContext,
  CellEditorProps,
  CellMove,
  CellViewProps,
  CommitDetails,
  PersonChoice,
  RowChoice,
} from './types';
