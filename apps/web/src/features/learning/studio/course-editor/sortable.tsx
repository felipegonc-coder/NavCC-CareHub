import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Announcements, DragEndEvent, UniqueIdentifier } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconButton } from '@carehub/ui';
import { GripVertical } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

const INSTRUCTIONS =
  'To reorder, press Space or Enter, move with the arrow keys, then press Space or Enter again. ' +
  'Escape cancels. The move up and move down buttons do the same.';

/** Props for {@link SortableList}. */
export type SortableListProps = {
  ids: string[];
  /** What to call an item in screen reader announcements. */
  name(id: string): string;
  /** An item was dropped at `toIndex`. */
  onMove(id: string, toIndex: number): void;
  children: ReactNode;
};

/** Drag-and-drop reordering (mouse, touch and keyboard) for the items below, with spoken positions. */
export function SortableList({ ids, name, onMove, children }: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const at = (id: UniqueIdentifier) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(String(active.id))}, ${at(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${name(String(active.id))} is now at ${at(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      `${name(String(active.id))} dropped at ${at(over?.id ?? active.id)}.`,
    onDragCancel: ({ active }) => `Moving ${name(String(active.id))} was cancelled.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onMove(String(active.id), ids.indexOf(String(over.id)));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** One item of a {@link SortableList}: a ref and style for the item, and its drag handle. */
export function useSortableItem(id: string, handleLabel: string) {
  const sortable = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const handle: ReactNode = (
    <IconButton
      size="sm"
      label={handleLabel}
      className="cursor-grab touch-none"
      ref={sortable.setActivatorNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <GripVertical aria-hidden />
    </IconButton>
  );
  return { ref: sortable.setNodeRef, style, handle, dragging: sortable.isDragging };
}
