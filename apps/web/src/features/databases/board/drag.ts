/**
 * Dragging cards with pointer events: a mouse press that moves a few pixels picks the card up; a
 * touch picks it up after a long press (a short one scrolls the board, and a long press that
 * doesn't move opens the card's menu). Escape puts it back.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { Id } from '@carehub/databases';
import type { Slot } from './model';

/** How far a mouse press moves before it becomes a drag; a shorter one is a click. */
const DRAG_START = 4;
/** How long a touch is held before the card can be dragged. */
const LONG_PRESS = 500;
/** How far a finger may wander during that time; further is a scroll. */
const TOUCH_SLOP = 8;

/** Presses on these inside a card don't drag it (its menu button, a title being typed). */
const NO_DRAG = 'input, textarea, [contenteditable="true"], [data-no-drag]';

/** Where a dragged card would land. */
export interface DropTarget {
  slot: Slot;
  beforeRowId: Id | null;
}

/** The card being dragged: the pointer, where the card was grabbed, and where it would land. */
export interface CardDrag {
  rowId: Id;
  from: Slot;
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  target: DropTarget | null;
}

export interface CardDragOptions {
  /** The board: its slots carry data-board-slot, data-group-key and data-lane-key. */
  root: RefObject<HTMLElement | null>;
  allowed(rowId: Id, from: Slot, to: Slot): boolean;
  onDrop(rowId: Id, from: Slot, target: DropTarget): void;
  /** A touch held still and let go: the card's menu. */
  onLongPress(rowId: Id, from: Slot): void;
  /** A drag began (menus close). */
  onStart?(): void;
}

const inside = (rect: DOMRect, x: number, y: number) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/** The slot an element stands for (data-group-key, and data-lane-key in lanes). */
export function slotOf(element: HTMLElement): Slot | null {
  const groupKey = element.dataset.groupKey;
  if (groupKey === undefined) return null;
  const laneKey = element.dataset.laneKey;
  return laneKey === undefined ? { groupKey } : { groupKey, laneKey };
}

/** The slot under the pointer and the card it would go before. */
function targetAt(root: HTMLElement, rowId: Id, x: number, y: number): DropTarget | null {
  const slots = [...root.querySelectorAll<HTMLElement>('[data-board-slot]')];
  const hit = slots.find((el) => inside(el.getBoundingClientRect(), x, y));
  const slot = hit ? slotOf(hit) : null;
  if (!hit || !slot) return null;
  const cards = [...hit.querySelectorAll<HTMLElement>('article[data-row-id]')].filter(
    (card) => card.dataset.rowId !== rowId,
  );
  const before = cards.find((card) => {
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  return { slot, beforeRowId: before?.dataset.rowId ?? null };
}

export function useCardDrag(options: CardDragOptions) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  // The press going on (to end it when the board goes), and whether a drag just ended: the click
  // that follows doesn't open the card.
  const [live] = useState<{ stop: (() => void) | null; dragged: boolean }>(() => ({
    stop: null,
    dragged: false,
  }));
  useEffect(() => () => live.stop?.(), [live]);

  /** The click that follows a drag or a long press doesn't open the card. */
  const swallowClick = () => {
    live.dragged = true;
    window.setTimeout(() => {
      live.dragged = false;
    }, 0);
  };

  /** Call from the card's onPointerDown. */
  const press = (event: PointerEvent<HTMLElement>, rowId: Id, from: Slot) => {
    if (event.button !== 0 || live.stop) return;
    if (event.target instanceof Element && event.target.closest(NO_DRAG)) return;
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const touch = event.pointerType === 'touch';
    const startX = event.clientX;
    const startY = event.clientY;
    let held = !touch;
    let current: CardDrag | null = null;
    let timer: number | undefined;
    // A mouse press doesn't select text on its way to a drag.
    if (!touch) event.preventDefault();

    const follow = (x: number, y: number) => {
      if (!current) return;
      const root = latest.current.root.current;
      let target = root ? targetAt(root, rowId, x, y) : null;
      if (target && !latest.current.allowed(rowId, from, target.slot)) target = null;
      current = { ...current, x, y, target };
      setDrag(current);
    };
    const finish = (drop: boolean) => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('touchmove', still);
      live.stop = null;
      const ended = current;
      current = null;
      if (!ended) return;
      swallowClick();
      setDrag(null);
      if (drop && ended.target) latest.current.onDrop(rowId, from, ended.target);
    };
    const move = (e: globalThis.PointerEvent) => {
      if (current) {
        follow(e.clientX, e.clientY);
        return;
      }
      const distance = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (!held) {
        if (distance > TOUCH_SLOP) finish(false);
        return;
      }
      if (distance < DRAG_START) return;
      current = {
        rowId,
        from,
        x: startX,
        y: startY,
        grabX: startX - rect.left,
        grabY: startY - rect.top,
        width: rect.width,
        target: null,
      };
      latest.current.onStart?.();
      follow(e.clientX, e.clientY);
    };
    const up = () => {
      if (touch && held && !current) {
        finish(false);
        swallowClick();
        latest.current.onLongPress(rowId, from);
        return;
      }
      finish(true);
    };
    const cancel = () => finish(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !current) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    // Once a touch is held, the finger drags the card instead of scrolling the page.
    const still = (e: TouchEvent) => {
      if (held && e.cancelable) e.preventDefault();
    };
    if (touch)
      timer = window.setTimeout(() => {
        held = true;
      }, LONG_PRESS);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    window.addEventListener('touchmove', still, { passive: false });
    live.stop = () => finish(false);
  };

  /** Call first in the card's onClick: true when the click only ended a drag. */
  const endedDrag = (): boolean => {
    const was = live.dragged;
    live.dragged = false;
    return was;
  };

  return { drag, press, endedDrag };
}
