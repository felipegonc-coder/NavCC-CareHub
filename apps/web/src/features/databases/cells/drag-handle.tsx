import { cn } from '@carehub/ui';
import { GripVertical } from 'lucide-react';
import type { Reorder } from './reorder';

/** The handle that drags item `index` of a list, or moves it with the up and down arrow keys. */
export function DragHandle({
  reorder,
  index,
  label,
  hintId,
  disabled = false,
}: {
  reorder: Reorder;
  index: number;
  /** What it moves ("Move High"). */
  label: string;
  /** The id of the hint that says how. */
  hintId: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={hintId}
      disabled={disabled}
      className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted hover:bg-fill disabled:cursor-not-allowed"
      {...reorder.handle(index)}
    >
      <GripVertical aria-hidden className="size-4" />
    </button>
  );
}

/** Item `index` while dragging: faded when it's the one moving, with a line where it would go. */
export function dragItemClass({ drag, count }: Reorder, index: number): string {
  return cn(
    'border-y-2 border-transparent',
    drag?.from === index && 'opacity-50',
    drag?.gap === index && 'border-t-primary',
    drag?.gap === index + 1 && index === count - 1 && 'border-b-primary',
  );
}
