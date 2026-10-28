/** Following a mouse or pen drag on the window, and finding the day under the pointer. */
import type { CalendarDate } from '@carehub/databases';

export interface PointerSpot {
  x: number;
  y: number;
  /** What the event happened on (the element under a mouse that isn't captured). */
  target: EventTarget | null;
}

export interface FollowHandlers {
  move(spot: PointerSpot): void;
  /** Escape was pressed: the drag is off, though the pointer is still down. */
  escape(): void;
  /**
   * The drag is over: the pointer went up (`cancelled` after Escape), or the browser stopped it
   * (`cancelled`, and no click follows).
   */
  end(spot: PointerSpot, cancelled: boolean): void;
}

/** How far a pointer moves before a press becomes a drag, px. */
export const DRAG_START = 4;

/** Follows one drag until the pointer goes up; Escape calls it off. Returns a stop function. */
export function followPointer(handlers: FollowHandlers): () => void {
  let last: PointerSpot = { x: 0, y: 0, target: null };
  let escaped = false;
  const spot = (event: MouseEvent): PointerSpot => ({
    x: event.clientX,
    y: event.clientY,
    target: event.target,
  });
  const move = (event: MouseEvent) => {
    if (escaped) return;
    last = spot(event);
    handlers.move(last);
  };
  // After Escape the drag ends when the pointer goes up, so the click that follows is swallowed.
  const up = (event: MouseEvent) => {
    stop();
    handlers.end(spot(event), escaped);
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

/** The calendar day under the pointer: the event's own target, else the element at that point. */
export function dayAt(spot: PointerSpot): CalendarDate | null {
  const fromTarget = spot.target instanceof Element ? spot.target : null;
  const element =
    fromTarget?.closest('[data-testid="calendar-day"]') ??
    (typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(spot.x, spot.y)?.closest('[data-testid="calendar-day"]')
      : null);
  return element?.getAttribute('data-date') ?? null;
}

/** Swallows the click a browser sends after a drag, so a drop doesn't also open or add a row. */
export function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}
