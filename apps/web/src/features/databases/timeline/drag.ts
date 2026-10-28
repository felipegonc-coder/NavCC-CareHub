/** Following a mouse or pen drag on the window (bars and their ends). */

export interface DragHandlers {
  /** How far the pointer is from where it went down, px. */
  move(dx: number): void;
  /** Escape was pressed: the drag is off, though the pointer is still down. */
  escape(): void;
  /**
   * The drag is over: the pointer went up (`cancelled` after Escape), or the browser stopped it
   * (`cancelled`, and no click follows).
   */
  end(dx: number, cancelled: boolean): void;
}

/** How far a pointer moves before a press becomes a drag, px. */
export const DRAG_START = 4;

/** Follows a drag sideways until the pointer goes up; Escape calls it off. Returns a stop function. */
export function followDrag(startX: number, handlers: DragHandlers): () => void {
  let last = 0;
  let escaped = false;
  const move = (event: MouseEvent) => {
    if (escaped) return;
    last = event.clientX - startX;
    handlers.move(last);
  };
  // After Escape the drag ends when the pointer goes up, so the click that follows is swallowed.
  const up = (event: MouseEvent) => {
    stop();
    handlers.end(escaped ? last : event.clientX - startX, escaped);
  };
  const cancel = () => {
    stop();
    handlers.end(last, true);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || escaped) return;
    event.preventDefault();
    escaped = true;
    handlers.escape();
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

/** Swallows the click a browser sends after a drag, so a drop doesn't also open the row. */
export function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}
