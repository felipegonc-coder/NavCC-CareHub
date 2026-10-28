import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import {
  applyEdit,
  gridKeyAction,
  moveFocus,
  type CalendarItem,
  type FocusEntry,
  type ItemTimes,
} from '../layout';
import { isTyping } from './shortcuts';

/** Marks each focusable item in the grid with its layout key. */
const KEY = 'data-grid-key';

/** The item's id in a layout key, `${item.id}@${date}`. */
export function itemIdOf(key: string): string {
  const at = key.lastIndexOf('@');
  return at < 0 ? key : key.slice(0, at);
}

export interface GridKeysOptions<Item extends CalendarItem> {
  /** The grid's focusable things in reading order: weekFocusOrder(…) or monthFocusOrder(…). */
  order: readonly FocusEntry[];
  /** The items drawn, found by the id in their keys. */
  items: readonly Item[];
  /**
   * Alt+↑/↓ (15 minutes), Alt+←/→ (a day) or Alt+Shift+↑/↓ (the end) on an item: its new times.
   * Save them as a drag does; read-only items refuse in the same way.
   */
  onEdit?: (item: Item, times: ItemTimes) => void;
  /** Ctrl+D on an item. */
  onDuplicate?: (item: Item) => void;
  /** Weekends hidden: Alt+← and Alt+→ skip Saturday and Sunday. */
  skipWeekends?: boolean;
}

export interface GridKeys {
  /** For the element around the grid. */
  gridProps: {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onFocus: (event: FocusEvent<HTMLElement>) => void;
  };
  /** For each item and "+N more" button: Tab stops once in the grid, on the last one focused. */
  itemProps: (key: string) => { 'data-grid-key': string; tabIndex: 0 | -1 };
}

function keyOf(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest(`[${KEY}]`)?.getAttribute(KEY) ?? null) : null;
}

function find(grid: HTMLElement, key: string): HTMLElement | undefined {
  return [...grid.querySelectorAll<HTMLElement>(`[${KEY}]`)].find(
    (element) => element.getAttribute(KEY) === key,
  );
}

/**
 * Keyboard in Day, Week and Month (Calendar spec, section 6): Tab reaches the grid, arrows move
 * between items in time order (← and → across days, ↑ and ↓ within a day), Enter opens one (it's
 * a button), Alt+arrows change its times and Ctrl+D duplicates it.
 */
export function useGridKeys<Item extends CalendarItem>({
  order,
  items,
  onEdit,
  onDuplicate,
  skipWeekends = false,
}: GridKeysOptions<Item>): GridKeys {
  const [active, setActive] = useState<string | null>(null);
  const grid = useRef<HTMLElement | null>(null);
  /** The id of the item an edit moved: focus follows it to its new place. */
  const moved = useRef<string | null>(null);
  const stop = order.some((entry) => entry.key === active) ? active : (order[0]?.key ?? null);

  useLayoutEffect(() => {
    const id = moved.current;
    moved.current = null;
    const entry = id === null ? undefined : order.find((each) => itemIdOf(each.key) === id);
    if (entry === undefined || !grid.current) return;
    setActive(entry.key);
    // Its block was drawn again elsewhere (another day), so focus went back to the page.
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost) find(grid.current, entry.key)?.focus();
  }, [order]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    grid.current = event.currentTarget;
    moved.current = null;
    const key = keyOf(event.target);
    if (key === null || event.defaultPrevented || isTyping(event.target)) return;
    const action = gridKeyAction(event);
    if (action === null) return;
    if (action.kind === 'focus') {
      // On an item, arrows only move focus: the hours don't scroll and ← → keep the period.
      event.preventDefault();
      const next = moveFocus(order, key, action.move);
      if (next !== null) find(event.currentTarget, next)?.focus();
      return;
    }
    const item = items.find((each) => each.id === itemIdOf(key));
    if (item === undefined) return;
    if (action.kind === 'duplicate') {
      if (!onDuplicate) return;
      // Browsers bookmark the page on Ctrl+D.
      event.preventDefault();
      onDuplicate(item);
      return;
    }
    // Some browsers go back or forward on Alt+← and Alt+→.
    event.preventDefault();
    const times = applyEdit(item, action.step, { skipWeekends });
    if (times === null || !onEdit) return;
    moved.current = item.id;
    onEdit(item, times);
  };

  return {
    gridProps: {
      onKeyDown,
      onFocus: (event) => {
        grid.current = event.currentTarget;
        const key = keyOf(event.target);
        if (key !== null) setActive(key);
      },
    },
    itemProps: (key) => ({ [KEY]: key, tabIndex: key === stop ? 0 : -1 }),
  };
}
