import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/** Props for one item's drag handle. */
export interface ReorderHandle {
  ref: (el: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface Reorder {
  /** How many items the list has. */
  count: number;
  /** Spread on item `index`'s drag handle. */
  handle: (index: number) => ReorderHandle;
  /** The ref for item `index`'s element, measured while dragging. */
  item: (index: number) => (el: HTMLElement | null) => void;
  /** While dragging: the item moving and the gap (0 to count) it would drop into. */
  drag: { from: number; gap: number } | null;
}

/**
 * Reorders a list by dragging an item's handle (pointer events, so mouse, pen and touch), or one
 * place at a time with the up and down arrow keys on the handle, which keeps focus.
 * `onMove(from, to)` gets the item's index and the index it ends up at.
 */
export function useReorder(count: number, onMove: (from: number, to: number) => void): Reorder {
  const items = useRef<(HTMLElement | null)[]>([]);
  const handles = useRef<(HTMLElement | null)[]>([]);
  const refocus = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; gap: number } | null>(null);

  // After a move by keyboard the list is in its new order: the handle that moved keeps focus.
  useLayoutEffect(() => {
    if (refocus.current === null) return;
    handles.current[refocus.current]?.focus();
    refocus.current = null;
  });

  const gapAt = (y: number): number => {
    for (let i = 0; i < count; i++) {
      const box = items.current[i]?.getBoundingClientRect();
      if (box && y < box.top + box.height / 2) return i;
    }
    return count;
  };

  const drop = (from: number, gap: number) => {
    const to = gap > from ? gap - 1 : gap;
    if (to !== from) onMove(from, to);
  };

  return {
    count,
    drag,
    item: (index) => (el) => {
      items.current[index] = el;
    },
    handle: (index) => ({
      ref: (el) => {
        handles.current[index] = el;
      },
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        try {
          // Moves and the release come to the handle even when the pointer leaves it.
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Not a live pointer (or no pointer capture here): dragging still works.
        }
        setDrag({ from: index, gap: index });
      },
      onPointerMove: (event) => {
        if (drag?.from !== index) return;
        const gap = gapAt(event.clientY);
        if (gap !== drag.gap) setDrag({ from: index, gap });
      },
      onPointerUp: (event) => {
        if (drag?.from !== index) return;
        setDrag(null);
        drop(index, gapAt(event.clientY));
      },
      onPointerCancel: () => setDrag(null),
      onKeyDown: (event) => {
        const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
        if (to < 0 || to >= count || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        refocus.current = to;
        onMove(index, to);
      },
    }),
  };
}
