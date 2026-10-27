import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** The card being dragged and where it would land. */
export interface Drag {
  from: number;
  slot: number;
}

/** A question card on screen: its place in the form and the middle of its box, from the top. */
export interface CardSpot {
  index: number;
  middle: number;
}

/**
 * Where a dragged card would land at height `y`: the place of the first card whose middle is below
 * the pointer, or `count` (after the last card).
 */
export function dropSlot(cards: readonly CardSpot[], y: number, count: number): number {
  return cards.find((spot) => y < spot.middle)?.index ?? count;
}

/** The dragged card's new place when it's dropped at `slot`, or null when it stays put. */
export function dropIndex(from: number, slot: number): number | null {
  const to = slot > from ? slot - 1 : slot;
  return to === from ? null : to;
}

/** Which edge of card `index` shows the drop line while dragging, if any. */
export function dropEdge(drag: Drag | null, index: number, count: number): 'top' | 'bottom' | null {
  if (!drag || dropIndex(drag.from, drag.slot) === null) return null;
  if (drag.slot === index) return 'top';
  return drag.slot === count && index === count - 1 ? 'bottom' : null;
}

/** Each card's list item carries its question's place, to measure the cards while dragging. */
export const CARD_INDEX = 'data-question-index';

/** How close to the top or bottom of the scrolling area (px) dragging scrolls it, and how fast. */
const EDGE = 48;
const STEP = 12;

function measure(list: HTMLElement): CardSpot[] {
  const spots: CardSpot[] = [];
  for (const item of Array.from(list.children)) {
    const index = item.getAttribute(CARD_INDEX);
    if (index === null) continue;
    const box = item.getBoundingClientRect();
    spots.push({ index: Number(index), middle: box.top + box.height / 2 });
  }
  return spots;
}

/** The nearest box around the list that scrolls, or null for the page. */
function scrollingArea(list: HTMLElement): HTMLElement | null {
  for (let el = list.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return null;
}

/** How far to scroll for a pointer at `y`: up near the top, down near the bottom, else 0. */
function scrollStep(area: HTMLElement | null, y: number): number {
  const box = area?.getBoundingClientRect();
  const top = box ? box.top : 0;
  const bottom = box ? box.bottom : window.innerHeight;
  if (y < top + EDGE) return -STEP;
  if (y > bottom - EDGE) return STEP;
  return 0;
}

interface Session extends Drag {
  y: number;
  area: HTMLElement | null;
  frame: number;
  stop(): void;
}

/**
 * Dragging question cards by their handles (pointer events, no library). The cards are the list's
 * items with `CARD_INDEX`; dropping one somewhere new calls `onDrop(from, to)`. Escape cancels,
 * and holding the pointer near the top or bottom scrolls.
 */
export function useReorder(
  list: { readonly current: HTMLElement | null },
  count: number,
  onDrop: (from: number, to: number) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const session = useRef<Session | null>(null);
  const latest = useRef({ count, onDrop });

  useEffect(() => {
    latest.current = { count, onDrop };
  });
  // Leaving the builder mid-drag stops listening.
  useEffect(() => {
    const live = session;
    return () => live.current?.stop();
  }, []);

  function start(index: number, event: ReactPointerEvent<HTMLElement>) {
    const items = list.current;
    if (event.button !== 0 || !items || session.current) return;
    const handle = event.currentTarget;
    try {
      // The handle keeps getting the pointer (and its cursor) wherever it goes.
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Not a live pointer: the window listeners below still follow it.
    }

    const place = () => {
      const s = session.current;
      if (!s) return;
      const slot = dropSlot(measure(items), s.y, latest.current.count);
      if (slot === s.slot) return;
      s.slot = slot;
      setDrag({ from: s.from, slot });
    };
    const autoScroll = () => {
      const s = session.current;
      if (!s) return;
      const step = scrollStep(s.area, s.y);
      if (step === 0) {
        s.frame = 0;
        return;
      }
      if (s.area) s.area.scrollTop += step;
      else window.scrollBy(0, step);
      place();
      s.frame = requestAnimationFrame(autoScroll);
    };
    const onMove = (e: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      s.y = e.clientY;
      place();
      if (!s.frame && scrollStep(s.area, s.y) !== 0) s.frame = requestAnimationFrame(autoScroll);
    };
    const finish = (drop: boolean) => {
      const s = session.current;
      if (!s) return;
      s.stop();
      const to = dropIndex(s.from, s.slot);
      if (drop && to !== null) latest.current.onDrop(s.from, to);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };

    session.current = {
      from: index,
      slot: index,
      y: event.clientY,
      area: scrollingArea(items),
      frame: 0,
      stop() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('blur', onCancel);
        window.removeEventListener('scroll', place, true);
        if (this.frame) cancelAnimationFrame(this.frame);
        session.current = null;
        setDrag(null);
      },
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
    window.addEventListener('scroll', place, true);
    setDrag({ from: index, slot: index });
  }

  return { drag, start };
}
