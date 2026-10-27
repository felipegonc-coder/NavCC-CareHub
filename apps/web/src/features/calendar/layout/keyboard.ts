import { daysBetween } from '@carehub/team-time';
import { stepDays } from './civil';
import { moveItem, resizeItem } from './interaction';
import { dateSpan } from './items';
import type { LaneRow, MonthLayout } from './lanes';
import type { TimedPlacement } from './timeGrid';
import { STEP_MINUTES } from './types';
import type { CalendarItem, ItemTimes } from './types';

export type FocusMove = 'up' | 'down' | 'left' | 'right';

/** Alt+↑/↓ (15 minutes), Alt+←/→ (a day) and Alt+Shift+↑/↓ (the end, 15 minutes). */
export type EditStep =
  'earlier' | 'later' | 'day-before' | 'day-after' | 'end-earlier' | 'end-later';

export type GridKeyAction =
  { kind: 'focus'; move: FocusMove } | { kind: 'edit'; step: EditStep } | { kind: 'duplicate' };

/** The parts of a KeyboardEvent the grid reads. */
export interface KeyPress {
  key: string;
  altKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** One focusable thing in the grid, in reading order. */
export interface FocusEntry {
  /** A placement or segment key, or moreKey(date) for a "+N more" button. */
  key: string;
  /** The day it's read with (Month counts across weeks); ← and → move between days. */
  dayIndex: number;
  /** Height within the day; ← and → land on the closest one. */
  position: number;
}

/** Below every hour, so all-day items read first and ← and → keep to the all-day row. */
const ALL_DAY_POSITION = -10_000;

export const moreKey = (date: string): string => `more@${date}`;

/**
 * Arrows move focus; Alt+arrows and Alt+Shift+↑/↓ edit the selected item; Ctrl+D duplicates it
 * (call preventDefault: browsers bookmark on Ctrl+D). Null: not ours.
 */
export function gridKeyAction(press: KeyPress): GridKeyAction | null {
  const onlyCtrl = press.ctrlKey === true && !press.altKey && !press.shiftKey && !press.metaKey;
  if (onlyCtrl && press.key.toLowerCase() === 'd') return { kind: 'duplicate' };
  const move = arrow(press.key);
  if (move === null || press.ctrlKey || press.metaKey) return null;
  if (!press.altKey) return press.shiftKey ? null : { kind: 'focus', move };
  if (press.shiftKey) {
    if (move === 'up') return { kind: 'edit', step: 'end-earlier' };
    return move === 'down' ? { kind: 'edit', step: 'end-later' } : null;
  }
  const steps = { up: 'earlier', down: 'later', left: 'day-before', right: 'day-after' } as const;
  return { kind: 'edit', step: steps[move] };
}

/**
 * New times for a keyboard edit, or null when it doesn't apply (minute steps on all-day items).
 * With skipWeekends (weekends hidden in Week or Month), a day step skips Saturday and Sunday.
 */
export function applyEdit(
  item: CalendarItem,
  step: EditStep,
  options: { skipWeekends?: boolean } = {},
): ItemTimes | null {
  switch (step) {
    case 'earlier':
    case 'later':
      return item.allDay
        ? null
        : moveItem(item, { minutes: step === 'later' ? STEP_MINUTES : -STEP_MINUTES });
    case 'end-earlier':
    case 'end-later':
      return resizeItem(item, { minutes: step === 'end-later' ? STEP_MINUTES : -STEP_MINUTES });
    case 'day-before':
    case 'day-after': {
      const from = dateSpan(item).first;
      const to = stepDays(from, step === 'day-after' ? 1 : -1, options.skipWeekends ?? false);
      return moveItem(item, { days: daysBetween(from, to) });
    }
  }
}

/** Day and Week reading order: per day, the all-day row (by lane), then the hours (top, left). */
export function weekFocusOrder(
  allDay: LaneRow | null,
  grid: readonly (readonly TimedPlacement[])[],
): FocusEntry[] {
  const top = allDay ? laneEntries(allDay, 0, ALL_DAY_POSITION) : [];
  return grid.flatMap((placements, dayIndex) => [
    ...top.filter((entry) => entry.dayIndex === dayIndex),
    ...placements.map((p) => ({ key: p.key, dayIndex, position: p.top })),
  ]);
}

/** Month reading order: day by day across the weeks, each day's drawn items then "+N more". */
export function monthFocusOrder(month: MonthLayout): FocusEntry[] {
  let offset = 0;
  return month.weeks.flatMap((week) => {
    const entries = laneEntries(week, offset, 0);
    offset += week.days.length;
    return entries;
  });
}

/**
 * The key to focus after an arrow: ↑ and ↓ stay within the day, ← and → go to the nearest day
 * with items and the closest item there. Null: nowhere to go. With no current key (Tab into
 * the grid) or a key that's gone, the first entry.
 */
export function moveFocus(
  order: readonly FocusEntry[],
  current: string | null,
  move: FocusMove,
): string | null {
  const index = order.findIndex((entry) => entry.key === current);
  const here = order[index];
  if (here === undefined) return order[0]?.key ?? null;
  if (move === 'up' || move === 'down') {
    const next = order[index + (move === 'down' ? 1 : -1)];
    return next?.dayIndex === here.dayIndex ? next.key : null;
  }
  const forward = move === 'right';
  let best: FocusEntry | undefined;
  for (const entry of order) {
    if (forward ? entry.dayIndex <= here.dayIndex : entry.dayIndex >= here.dayIndex) continue;
    const nearer =
      best === undefined ||
      (forward ? entry.dayIndex < best.dayIndex : entry.dayIndex > best.dayIndex) ||
      (entry.dayIndex === best.dayIndex &&
        Math.abs(entry.position - here.position) < Math.abs(best.position - here.position));
    if (nearer) best = entry;
  }
  return best?.key ?? null;
}

function laneEntries(row: LaneRow, offset: number, base: number): FocusEntry[] {
  return row.days.flatMap((date, day) => {
    const entries = row.segments
      .filter((segment) => segment.visible && segment.startIndex === day)
      .sort((a, b) => a.lane - b.lane)
      .map((segment) => ({
        key: segment.key,
        dayIndex: offset + day,
        position: base + segment.lane,
      }));
    if ((row.more[day] ?? 0) > 0) {
      entries.push({
        key: moreKey(date),
        dayIndex: offset + day,
        position: base + row.visibleLanes,
      });
    }
    return entries;
  });
}

function arrow(key: string): FocusMove | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}
