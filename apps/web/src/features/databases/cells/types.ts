import type {
  ComputedValue,
  EvalContext,
  FileRef,
  Id,
  Property,
  SelectOption,
} from '@carehub/databases';
import type { RowPick } from '../api';

/**
 * What cells need besides the value: the viewer (time zone, 12- or 24-hour clock) and names for
 * people and related rows, as in EvalContext. The rest is optional.
 */
export interface CellContext extends Omit<EvalContext, 'properties' | 'computed'> {
  /** The database's properties (formula and rollup text may need them). */
  properties?: readonly Property[];
  /** Photo for a user id. */
  userAvatar?(id: Id): string | undefined;
  /** Where an uploaded file opens (web links open their own address). */
  fileHref?(file: FileRef): string | undefined;
  /** Where a related row opens; without it related rows show as plain chips. */
  rowHref?(id: Id): string | undefined;
}

/** Where Tab (next) or Shift+Tab (previous) moves; the caller decides which cell that is. */
export type CellMove = 'next' | 'previous';

export interface CommitDetails {
  /** Set when the editor was left with Tab or Shift+Tab. */
  move?: CellMove;
  /** Options typed into a Select or Multi-select: add them to the property before saving. */
  newOptions?: SelectOption[];
  /** false when the value is the same as before (nothing to save). */
  changed: boolean;
}

export interface CellViewProps {
  property: Property;
  /** The row's value as readValue gives it (stored form; null or undefined is empty). */
  value: unknown;
  /** A formula's or rollup's result; without it `value` is read as one. */
  computed?: ComputedValue;
  ctx: CellContext;
  /** Long text wraps onto more lines instead of being cut off. */
  wrap?: boolean;
  /** Checkbox: ticks straight from the cell. Without it the box is only drawn. */
  onToggle?: (checked: boolean) => void;
  /** Button: runs its actions (a promise keeps the spinner on). Without it the button is greyed out. */
  onPress?: () => unknown;
  /** Why the button can't be pressed, shown on hover ("Only people who can edit this page"). */
  pressBlockedReason?: string;
  /** Relation: links to rows the viewer can't open, counted (QueryRow.hiddenLinks). */
  hiddenLinks?: number;
  className?: string;
}

/** Someone who can be picked in a Person cell. */
export interface PersonChoice {
  id: Id;
  name: string;
  email?: string;
  avatarUrl?: string;
}

/** A row of the target database in a Relation picker (as `pickRows` answers). */
export type RowChoice = RowPick;

export interface CellEditorProps {
  property: Property;
  /** The current value in stored form (null or undefined is empty). */
  value: unknown;
  ctx: CellContext;
  /** Enter, Tab or a click outside saves; `value` is in stored form, null for empty. */
  onCommit: (value: unknown, details: CommitDetails) => void;
  /** Escape leaves without saving (read-only cells pass `move` for Tab too). */
  onCancel: (details?: { move?: CellMove }) => void;
  /** Text typed into the selected cell to start editing: it replaces the value (or searches). */
  initialText?: string;
  /** Select and Multi-select: typing a new name creates an option. False for Can edit content. */
  canCreateOptions?: boolean;
  /** Person: the people who can be picked. */
  people?: readonly PersonChoice[];
  /** Relation: the target database's rows matching a search ("" lists the first ones). */
  searchRows?: (query: string) => Promise<readonly RowChoice[]>;
  /** Relation: adds a row to the target database ("+ New row"). */
  onCreateRow?: (title: string) => Promise<RowChoice>;
  /** Files: uploads one file and gives back its reference. */
  onUpload?: (file: File) => Promise<FileRef>;
  /** Button: as in CellView. */
  onPress?: () => unknown;
  pressBlockedReason?: string;
  /** Relation: as in CellView. The server keeps these links when the value is saved. */
  hiddenLinks?: number;
  /** The cell it opens over; by default the element it's rendered in (which must be positioned). */
  anchor?: Element | null;
}
