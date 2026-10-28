import { Button, IconButton } from '@carehub/ui';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

/** A copy of `list` with the item at `from` moved to `to`. */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export type ListControlsProps = {
  /** Reads like "picture 2" or "spot 3". */
  name: string;
  index: number;
  count: number;
  onMove(toIndex: number): void;
  onRemove(): void;
  /** False when the list can't get shorter. */
  canRemove?: boolean;
};

/** Move up, move down and remove, for one item of a list in an editor. */
export function ListControls({
  name,
  index,
  count,
  onMove,
  onRemove,
  canRemove = true,
}: ListControlsProps) {
  return (
    <div className="flex shrink-0 gap-1">
      <IconButton
        label={`Move ${name} up`}
        size="sm"
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ArrowUp aria-hidden />
      </IconButton>
      <IconButton
        label={`Move ${name} down`}
        size="sm"
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ArrowDown aria-hidden />
      </IconButton>
      <IconButton label={`Remove ${name}`} size="sm" disabled={!canRemove} onClick={onRemove}>
        <Trash2 aria-hidden />
      </IconButton>
    </div>
  );
}

/** An "Add …" button under a list. Turned off once the list is full, saying so. */
export function AddButton({
  children,
  full,
  max,
  onAdd,
}: {
  children: ReactNode;
  full: boolean;
  max: number;
  onAdd(): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" disabled={full} onClick={onAdd}>
        <Plus aria-hidden />
        {children}
      </Button>
      {full && <p className="text-small text-muted">This list is full ({max} at most).</p>}
    </div>
  );
}
