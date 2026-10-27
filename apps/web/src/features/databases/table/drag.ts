/** What a drag reports: how far the pointer is from where it went down, in px. */
export interface DragHandlers {
  move(dx: number, clientX: number): void;
  /** The pointer went up; `cancelled` when Escape or the browser stopped the drag. */
  end(dx: number, clientX: number, cancelled: boolean): void;
}

/**
 * Follows one pointer drag on the window, so it keeps going when the pointer leaves the element
 * it started on. Returns a function that stops following without calling `end`.
 */
export function followDrag(startX: number, handlers: DragHandlers): () => void {
  let lastX = startX;
  const move = (event: PointerEvent) => {
    lastX = event.clientX;
    handlers.move(lastX - startX, lastX);
  };
  const up = (event: PointerEvent) => {
    stop();
    handlers.end(event.clientX - startX, event.clientX, false);
  };
  const cancel = () => {
    stop();
    handlers.end(lastX - startX, lastX, true);
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

/** How far a pointer moves before a press on a header becomes a drag, px. */
export const DRAG_START = 4;
