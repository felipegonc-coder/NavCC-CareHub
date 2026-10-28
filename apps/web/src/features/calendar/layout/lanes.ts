import type { CivilDate } from '@carehub/team-time';
import { compareItems, dateSpan } from './items';
import type { MonthCell, MonthMatrix } from './period';
import { VISIBLE_ITEMS } from './types';
import type { CalendarItem } from './types';

export interface LaneOptions {
  /** Lanes drawn before "+N more" (default 3). Infinity draws everything (an expanded row). */
  maxVisible?: number;
}

/** One bar or chip in a row of days: an item's part within this row. */
export interface LaneSegment<T extends CalendarItem = CalendarItem> {
  /** Unique per drawn segment: `<id>@<first date in this row>`. */
  key: string;
  item: T;
  /** First and last day column covered in this row (inclusive). */
  startIndex: number;
  endIndex: number;
  lane: number;
  /** False past the visible limit: the item is counted in "+N more" instead of drawn. */
  visible: boolean;
  /** Starts before / ends after this segment (an earlier or later week, or a hidden day). */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface LaneRow<T extends CalendarItem = CalendarItem> {
  days: CivilDate[];
  segments: LaneSegment<T>[];
  /** Lanes in use, and how many to draw (at most the visible limit). */
  laneCount: number;
  visibleLanes: number;
  /** Per day column: items not drawn, for "+N more" (0 for none). */
  more: number[];
}

export interface MonthWeekLayout<T extends CalendarItem = CalendarItem> extends LaneRow<T> {
  cells: MonthCell[];
}

export interface MonthLayout<T extends CalendarItem = CalendarItem> {
  month: string;
  weeks: MonthWeekLayout<T>[];
}

/** The all-day row of Day and Week: all-day items in lanes across the day columns. */
export function layoutAllDayRow<T extends CalendarItem>(
  items: readonly T[],
  days: readonly CivilDate[],
  options: LaneOptions = {},
): LaneRow<T> {
  return layoutLanes(
    items.filter((item) => item.allDay),
    days,
    options,
  );
}

/** Month: every item in lanes per week; multi-day items become bars, split at week breaks. */
export function layoutMonth<T extends CalendarItem>(
  items: readonly T[],
  matrix: MonthMatrix,
  options: LaneOptions = {},
): MonthLayout<T> {
  return {
    month: matrix.month,
    weeks: matrix.weeks.map((cells) => ({
      ...layoutLanes(
        items,
        cells.map((cell) => cell.date),
        options,
      ),
      cells,
    })),
  };
}

/** Each date's items in agenda order: the "+N more" list, phone Month dots and the day's list. */
export function itemsByDate<T extends CalendarItem>(
  items: readonly T[],
  dates: readonly CivilDate[],
): Map<CivilDate, T[]> {
  const result = new Map(dates.map((date): [CivilDate, T[]] => [date, []]));
  for (const item of items) {
    const { first, last } = dateSpan(item);
    for (const date of dates) if (date >= first && date <= last) result.get(date)?.push(item);
  }
  for (const list of result.values()) list.sort(compareItems);
  return result;
}

function layoutLanes<T extends CalendarItem>(
  items: readonly T[],
  days: readonly CivilDate[],
  options: LaneOptions,
): LaneRow<T> {
  const limit = Math.max(0, Math.floor(options.maxVisible ?? VISIBLE_ITEMS));
  const segments: LaneSegment<T>[] = [];
  for (const item of items) {
    const { first, last } = dateSpan(item);
    const startIndex = days.findIndex((date) => date >= first);
    const endIndex = days.findLastIndex((date) => date <= last);
    const [startDate, endDate] = [days[startIndex], days[endIndex]];
    if (startDate === undefined || endDate === undefined || endIndex < startIndex) continue;
    segments.push({
      key: `${item.id}@${startDate}`,
      item,
      startIndex,
      endIndex,
      lane: 0,
      visible: true,
      continuesBefore: first < startDate,
      continuesAfter: last > endDate,
    });
  }
  const length = (segment: LaneSegment<T>) => segment.endIndex - segment.startIndex;
  segments.sort(
    (a, b) => a.startIndex - b.startIndex || length(b) - length(a) || compareItems(a.item, b.item),
  );
  const lanes: boolean[][] = [];
  for (const segment of segments) {
    const covered = (lane: boolean[]) =>
      lane.slice(segment.startIndex, segment.endIndex + 1).some(Boolean);
    let index = lanes.findIndex((lane) => !covered(lane));
    if (index === -1) index = lanes.push(days.map(() => false)) - 1;
    lanes[index]?.fill(true, segment.startIndex, segment.endIndex + 1);
    segment.lane = index;
    segment.visible = index < limit;
  }
  const more = days.map(
    (_, day) =>
      segments.filter((s) => !s.visible && s.startIndex <= day && day <= s.endIndex).length,
  );
  return {
    days: [...days],
    segments,
    laneCount: lanes.length,
    visibleLanes: Math.min(lanes.length, limit),
    more,
  };
}
