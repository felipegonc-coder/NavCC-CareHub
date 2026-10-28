/**
 * Reordering a list by dragging a row's handle (pointer events, no drag library) or with the
 * arrow keys on the handle. The Properties and Group panels use it.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { dropIndex } from './sort-model';

export interface DragState {
  /** The row being dragged. */
  from: number;
  /** Where it would land. */
  to: number;
}

interface Drag extends DragState {
  /** The rows' vertical middles when the drag started. */
  middles: number[];
}

export interface HandleProps {
  ref(el: HTMLButtonElement | null): void;
  onPointerDown(e: PointerEvent<HTMLButtonElement>): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}

export interface Reorder {
  /** The drag on its way, if any. */
  drag: DragState | null;
  /** The ref of row `index`, measured when a drag starts. */
  rowRef(index: number): (el: HTMLElement | null) => void;
  /** What row `index`'s handle (an IconButton) needs. */
  handle(index: number): HandleProps;
}

/** `move(from, to)` saves the new order. After a move by keys, focus stays on the moved handle. */
export function useReorder(count: number, move: (from: number, to: number) => void): Reorder {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const handles = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (focusAt === null) return;
    handles.current[focusAt]?.focus();
    setFocusAt(null);
  }, [focusAt]);

  // The pointer's moves are followed on the window so a fast drag isn't lost.
  const latest = useRef({ drag, move });
  useEffect(() => {
    latest.current = { drag, move };
  });
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: globalThis.PointerEvent) => {
      const current = latest.current.drag;
      if (!current) return;
      const to = dropIndex(current.middles, e.clientY, current.from);
      if (to !== current.to) setDrag({ ...current, to });
    };
    const onUp = (e: globalThis.PointerEvent) => {
      const current = latest.current.drag;
      setDrag(null);
      if (!current) return;
      const to = dropIndex(current.middles, e.clientY, current.from);
      if (to !== current.from) latest.current.move(current.from, to);
    };
    const onCancel = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [dragging]);

  return {
    drag: drag && { from: drag.from, to: drag.to },
    rowRef: (index) => (el) => {
      rows.current[index] = el;
    },
    handle: (index) => ({
      ref: (el) => {
        handles.current[index] = el;
      },
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const middles = Array.from({ length: count }, (_, i) => {
          const box = rows.current[i]?.getBoundingClientRect();
          return box ? box.top + box.height / 2 : 0;
        });
        setDrag({ from: index, to: index, middles });
      },
      onKeyDown: (e) => {
        const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
        if (to === null || to < 0 || to >= count) return;
        e.preventDefault();
        move(index, to);
        setFocusAt(to);
      },
    }),
  };
}
