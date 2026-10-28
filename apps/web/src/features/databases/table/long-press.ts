/** A touch held this long opens a row's menu (ms). */
export const LONG_PRESS_MS = 500;
/** A finger moving further than this first is scrolling, not a long press (px). */
export const LONG_PRESS_SLOP = 10;
/** The click after a long press comes this soon after the finger lifts (ms); later ones count. */
const CLICK_WINDOW = 400;

export interface Clock {
  set(run: () => void, ms: number): number;
  clear(id: number): void;
  now(): number;
}

const browserClock: Clock = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (id) => window.clearTimeout(id),
  now: () => Date.now(),
};

export interface PressPoint {
  pointerType: string;
  clientX: number;
  clientY: number;
}

/** Long presses on touch screens (a mouse never makes one). */
export interface LongPress {
  /** A pointer goes down: `fire` runs if it's a finger or pen held still long enough. */
  start(event: PressPoint, fire: () => void): void;
  move(event: PressPoint): void;
  /** The pointer lifts or is cancelled. */
  end(): void;
  /** True for the click that follows a long press (once): it isn't a tap. */
  takeClick(): boolean;
  /** A long press is under way or has just fired: the browser's own menu stays shut. */
  busy(): boolean;
}

export function longPress(clock: Clock = browserClock): LongPress {
  let timer: number | null = null;
  let origin = { x: 0, y: 0 };
  let fired = false;
  let liftedAt: number | null = null;
  const cancel = () => {
    if (timer !== null) clock.clear(timer);
    timer = null;
  };
  return {
    start(event, fire) {
      cancel();
      fired = false;
      liftedAt = null;
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      origin = { x: event.clientX, y: event.clientY };
      timer = clock.set(() => {
        timer = null;
        fired = true;
        fire();
      }, LONG_PRESS_MS);
    },
    move(event) {
      const far = Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP;
      if (timer !== null && far) cancel();
    },
    end() {
      cancel();
      if (fired && liftedAt === null) liftedAt = clock.now();
    },
    takeClick() {
      const late = liftedAt !== null && clock.now() - liftedAt > CLICK_WINDOW;
      const take = fired && !late;
      fired = false;
      liftedAt = null;
      return take;
    },
    busy: () => timer !== null || fired,
  };
}
