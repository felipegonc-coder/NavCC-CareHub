import { describe, expect, it } from 'vitest';
import { LONG_PRESS_MS, longPress, type Clock } from './long-press';

/** A clock the test moves by hand. */
function testClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: Clock = {
    set: (run, ms) => {
      timers.set(next, { at: now + ms, run });
      return next++;
    },
    clear: (id) => void timers.delete(id),
    now: () => now,
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    }
  };
  return { clock, advance };
}

const touch = (clientX = 100, clientY = 100) => ({ pointerType: 'touch', clientX, clientY });

describe('longPress', () => {
  it('fires when a finger stays put, and the click after it is not a tap', () => {
    const { clock, advance } = testClock();
    const press = longPress(clock);
    let fired = 0;
    press.start(touch(), () => (fired += 1));
    advance(LONG_PRESS_MS - 1);
    expect(fired).toBe(0);
    expect(press.busy()).toBe(true);
    advance(1);
    expect(fired).toBe(1);
    press.end();
    expect(press.takeClick()).toBe(true);
    expect(press.takeClick()).toBe(false);
  });

  it('never fires for a mouse', () => {
    const { clock, advance } = testClock();
    const press = longPress(clock);
    let fired = 0;
    press.start({ pointerType: 'mouse', clientX: 0, clientY: 0 }, () => (fired += 1));
    advance(LONG_PRESS_MS * 2);
    expect(fired).toBe(0);
    expect(press.busy()).toBe(false);
  });

  it('stops when the finger moves (a scroll) or lifts first', () => {
    const { clock, advance } = testClock();
    const press = longPress(clock);
    let fired = 0;
    press.start(touch(), () => (fired += 1));
    press.move(touch(104, 106));
    advance(100);
    press.move(touch(100, 130));
    advance(LONG_PRESS_MS);
    expect(fired).toBe(0);
    press.start(touch(), () => (fired += 1));
    advance(200);
    press.end();
    advance(LONG_PRESS_MS);
    expect(fired).toBe(0);
    expect(press.takeClick()).toBe(false);
  });

  it('lets a later click count when none came right after the long press', () => {
    const { clock, advance } = testClock();
    const press = longPress(clock);
    press.start(touch(), () => undefined);
    advance(LONG_PRESS_MS);
    press.end();
    advance(1000);
    expect(press.takeClick()).toBe(false);
    expect(press.busy()).toBe(false);
  });
});
