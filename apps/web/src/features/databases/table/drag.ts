/** Where the pointer is, px from the window's top left corner. */
export interface Point {
  x: number;
  y: number;
}

/** What following a pointer reports. */
export interface PointerHandlers {
  move(point: Point): void;
  /** The pointer went up; `cancelled` when Escape or the browser stopped the drag. */
  end(point: Point, cancelled: boolean): void;
}

/**
 * Follows one pointer drag on the window, so it keeps going when the pointer leaves the element
 * it started on. Returns a function that stops following without calling `end`.
 */
export function followPointer(start: Point, handlers: PointerHandlers): () => void {
  let last = start;
  const move = (event: PointerEvent) => {
    last = { x: event.clientX, y: event.clientY };
    handlers.move(last);
  };
  const up = (event: PointerEvent) => {
    stop();
    handlers.end({ x: event.clientX, y: event.clientY }, false);
  };
  const cancel = () => {
    stop();
    handlers.end(last, true);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancel();
  };
  function stop() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
  return stop;
}

/** What a drag sideways reports: how far the pointer is from where it went down, in px. */
export interface DragHandlers {
  move(dx: number, clientX: number): void;
  /** The pointer went up; `cancelled` when Escape or the browser stopped the drag. */
  end(dx: number, clientX: number, cancelled: boolean): void;
}

/** Follows a drag sideways (column edges and headers). */
export function followDrag(startX: number, handlers: DragHandlers): () => void {
  return followPointer(
    { x: startX, y: 0 },
    {
      move: (point) => handlers.move(point.x - startX, point.x),
      end: (point, cancelled) => handlers.end(point.x - startX, point.x, cancelled),
    },
  );
}

/** How far a pointer moves before a press becomes a drag, px. */
export const DRAG_START = 4;
