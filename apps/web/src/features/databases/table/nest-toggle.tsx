import { ChevronDown, ChevronRight } from 'lucide-react';
import { CELL_TEXT } from './cell-adapter';
import { TABLE_TEXT } from './messages';
import type { NestedRow } from './nesting';

export interface NestToggleProps {
  row: NestedRow & { title: string };
  /** The row's sub-items show. */
  open: boolean;
  onToggle(): void;
}

/** Before a Name: one step in per level, and the arrow when the row has sub-items. */
export function NestToggle({ row, open, onToggle }: NestToggleProps) {
  const steps = Array.from({ length: row.depth ?? 0 }, (_, level) => (
    <span key={level} aria-hidden className="w-5 shrink-0" />
  ));
  if ((row.childCount ?? 0) === 0) {
    return (
      <>
        {steps}
        <span aria-hidden className="w-5 shrink-0 max-md:w-11" />
      </>
    );
  }
  const Arrow = open ? ChevronDown : ChevronRight;
  return (
    <>
      {steps}
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={open}
        aria-label={TABLE_TEXT.subItemsOf(row.title || CELL_TEXT.untitled)}
        onClick={onToggle}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-fill-hover max-md:size-11"
      >
        <Arrow aria-hidden className="size-4" />
      </button>
    </>
  );
}
