/**
 * Stand-ins for W3-3's cells (`../cells`) until they're on main. Same names and props (a subset),
 * so switching is one change to this file:
 *
 *   export { CellEditor, CellView, rowCell } from '../cells';
 *   export type { CellContext, CellMove, CommitDetails } from '../cells';
 *
 * They show a value as text (formatValue) and edit it as text (parseTyped).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@carehub/ui';
import {
  isEmptyValue,
  readValue,
  type ComputedValue,
  type EvalContext,
  type Property,
  type ReadValue,
  type Row,
  type SelectOption,
} from '@carehub/databases';
import { formatComputed, formatValue, parseTyped } from '@carehub/databases/values';
import type { QueryRow } from '../contract';
import { TABLE_TEXT } from './messages';

/** The viewer and names for people and related rows, as in EvalContext. */
export interface CellContext extends Omit<EvalContext, 'properties' | 'computed'> {
  properties?: readonly Property[];
}

/** Where Tab (next) or Shift+Tab (previous) goes after an edit. */
export type CellMove = 'next' | 'previous';

export interface CommitDetails {
  move?: CellMove;
  /** Options typed into a Select or Multi-select that don't exist yet. */
  newOptions?: SelectOption[];
  /** false when the value is the same as before. */
  changed: boolean;
}

/** A row's value for one property, from a view's answer. */
export interface CellData {
  value: unknown;
  computed?: ComputedValue;
  hiddenLinks?: number;
}

const EMPTY: ComputedValue = { kind: 'empty' };

function storedRow(row: QueryRow): Row {
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

function moment(at: string | null) {
  return at ? { start: at, end: null, hasTime: true } : null;
}

export function rowCell(row: QueryRow, property: Property): CellData {
  switch (property.config.type) {
    case 'formula':
    case 'rollup':
      return { value: null, computed: row.computed[property.id] ?? EMPTY };
    case 'created_time':
      return { value: moment(row.createdAt) };
    case 'edited_time':
      return { value: moment(row.editedAt) };
    case 'relation':
      return {
        value: readValue(storedRow(row), property),
        hiddenLinks: row.hiddenLinks[property.id] ?? 0,
      };
    default:
      return { value: readValue(storedRow(row), property) };
  }
}

function evalContext(ctx: CellContext): EvalContext {
  return { ...ctx, properties: ctx.properties ?? [] };
}

function cellText(property: Property, value: unknown, ctx: CellContext): string {
  if (isEmptyValue(value as ReadValue)) return '';
  return formatValue(property, value as ReadValue, evalContext(ctx));
}

export interface CellViewProps {
  property: Property;
  value: unknown;
  computed?: ComputedValue;
  ctx: CellContext;
  wrap?: boolean;
  /** Checkbox: ticks straight from the cell. Without it the box is only drawn. */
  onToggle?: (checked: boolean) => void;
  hiddenLinks?: number;
  className?: string;
}

export function CellView({
  property,
  value,
  computed,
  ctx,
  wrap = false,
  onToggle,
  className,
}: CellViewProps) {
  const textClass = cn(wrap ? 'whitespace-pre-wrap break-words' : 'truncate', className);
  if (property.config.type === 'checkbox') {
    const checked = value === true;
    if (!onToggle) {
      return checked ? <Check aria-hidden className="size-4 shrink-0 text-fg" /> : null;
    }
    return (
      <input
        type="checkbox"
        aria-label={property.name}
        checked={checked}
        tabIndex={-1}
        onChange={(event) => onToggle(event.target.checked)}
        className="size-4 shrink-0 accent-primary"
      />
    );
  }
  if (property.config.type === 'title') {
    const title = typeof value === 'string' ? value : '';
    return (
      <span className={cn(textClass, !title && 'text-muted')}>{title || TABLE_TEXT.untitled}</span>
    );
  }
  const text = computed
    ? formatComputed(computed, null, evalContext(ctx))
    : cellText(property, value, ctx);
  return <span className={textClass}>{text}</span>;
}

export interface CellEditorProps {
  property: Property;
  value: unknown;
  ctx: CellContext;
  /** Enter, Tab or a click outside saves; `value` is in stored form, null for empty. */
  onCommit: (value: unknown, details: CommitDetails) => void;
  /** Escape leaves without saving. */
  onCancel: (details?: { move?: CellMove }) => void;
  /** Text typed into the selected cell to start editing: it replaces the value. */
  initialText?: string;
  canCreateOptions?: boolean;
  hiddenLinks?: number;
}

/** Edits a value as text over the cell it's rendered in (which must be positioned). */
export function CellEditor({
  property,
  value,
  ctx,
  onCommit,
  onCancel,
  initialText,
}: CellEditorProps) {
  const [text, setText] = useState(() => initialText ?? cellText(property, value, ctx));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const save = (move?: CellMove): boolean => {
    if (done.current) return true;
    const result = parseTyped(property, text, ctx.viewer);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    done.current = true;
    const details: CommitDetails = {
      changed: JSON.stringify(result.value ?? null) !== JSON.stringify(value ?? null),
    };
    if (move) details.move = move;
    if (result.newOptions?.length) details.newOptions = result.newOptions;
    onCommit(result.value, details);
    return true;
  };

  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      save(event.shiftKey ? 'previous' : 'next');
    }
  };

  return (
    <div
      data-cell-editor=""
      className="absolute inset-x-0 top-0 z-30 min-h-full rounded-sm bg-bg shadow-menu"
    >
      <input
        ref={input}
        aria-label={property.name}
        aria-invalid={error ? true : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!save()) cancel();
        }}
        className="w-full rounded-sm bg-bg px-2 py-1.5 text-small text-fg outline outline-2 outline-ring"
      />
      {error && (
        <p role="alert" className="px-2 py-1 text-label text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
