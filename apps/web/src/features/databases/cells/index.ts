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
 * - `PropertyMenu` wraps a property's header button with its menu: rename, change type, hide in
 *   this view, insert left or right, duplicate, property access and delete, plus the layout's own
 *   items (`viewItems`). Give it `usePropertyActions(meta.id)`, and the view, `updateView` and
 *   rows the layout has. Changes that clear or remove values confirm first with a count.
 * - `PropertySettings` is Edit property: name, description, row pages and the type's settings
 *   (number display, date and time format, Select and Multi-select options, person, relation, ID
 *   prefix). `PropertyMenu` opens it by the header unless it gets `onEditProperty`.
 *   `NumberDisplaySettings` is there for formula and rollup results too.
 * - `DeletedProperties` is the Properties → Deleted list, each with Restore.
 * - `openButtonLink` opens a button press's links: http and https only, in a new tab.
 */
export { openButtonLink } from './button-links';
export { CellEditor } from './cell-editor';
export { CellView, RichTextView } from './cell-view';
export {
  CheckMark,
  FileChip,
  HiddenRowsChip,
  OptionChip,
  PersonChip,
  RowChip,
  VerificationBadge,
} from './chips';
export {
  DeletedProperties,
  type DeletedPropertiesProps,
  type DeletedProperty,
} from './deleted-properties';
export {
  CELL_TEXT,
  DAY_REMINDER_LABELS,
  OPTION_COLOR_LABELS,
  PROPERTY_TEXT,
  SETTINGS_TEXT,
  STATUS_GROUP_LABELS,
  TIME_REMINDER_LABELS,
} from './messages';
export { NumberDisplaySettings, type NumberDisplaySettingsProps } from './number-settings';
export { usePropertyActions, type PropertyActions } from './property-actions';
export {
  canChangeProperties,
  checkPropertyName,
  NEW_PROPERTY_TYPES,
  newPropertyTypes,
  typeChoices,
  type NewPropertyType,
  type InsertSide,
  type TargetType,
} from './property-logic';
export { PropertyMenu, type PropertyMenuEvent, type PropertyMenuProps } from './property-menu';
export {
  PropertySettings,
  PropertySettingsPopover,
  type DatabaseChoice,
  type PropertySettingsPopoverProps,
  type PropertySettingsProps,
} from './property-settings';
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
export { PropertyTypeIcon } from './type-icon';
