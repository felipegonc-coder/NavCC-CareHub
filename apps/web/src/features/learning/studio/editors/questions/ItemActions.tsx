import { Button, IconButton } from '@carehub/ui';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

/** Props for {@link ItemActions}. `name` reads like "answer 2"; `count` is the length of the list. */
export type ItemActionsProps = {
  name: string;
  index: number;
  count: number;
  canRemove: boolean;
  onMove(toIndex: number): void;
  onRemove(): void;
};

/** Move up, move down and remove buttons for one answer, pair, step, part or area. */
export function ItemActions({ name, index, count, canRemove, onMove, onRemove }: ItemActionsProps) {
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

/** An "Add …" button under a list; it's disabled once the list is full. */
export function AddButton({
  children,
  full,
  onAdd,
}: {
  children: ReactNode;
  full: boolean;
  onAdd(): void;
}) {
  return (
    <Button variant="secondary" size="sm" disabled={full} onClick={onAdd}>
      <Plus aria-hidden />
      {children}
    </Button>
  );
}
