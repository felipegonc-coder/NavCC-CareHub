import type { CalendarItem as ApiItem, Layer } from '@carehub/team-calendar-api';
import {
  addDays,
  datePart,
  formatDate,
  formatTime,
  formatTimeRange,
  toCivil,
  type CivilDate,
  type CivilDateTime,
  type TimePrefs,
} from '@carehub/team-time';
import { isColorName, type ColorName } from '@carehub/ui';
import type { CalendarItem } from '../layout';

/** An item as the grid draws it: civil times in the viewer's zone, and what its block shows. */
export interface GridItem extends CalendarItem {
  item: ApiItem;
  /** The title, or "(No title)". */
  title: string;
  /** Its layer's colour. */
  color: ColorName;
  /** What screen readers hear: "QA calibration, Tuesday, October 27, 10:00 to 11:00 AM, Meetings". */
  label: string;
}

export const NO_TITLE = '(No title)';

/**
 * The items to draw: those on layers that are on, in the viewer's time zone. Until the layers have
 * loaded, every item shows, in the default colour.
 */
export function gridItems(
  items: readonly ApiItem[],
  layers: readonly Layer[] | undefined,
  prefs: Pick<TimePrefs, 'timeZone' | 'use24h'>,
): GridItem[] {
  const byId = new Map((layers ?? []).map((layer) => [layer.id, layer]));
  return items
    .filter((item) => byId.get(item.layerId)?.on !== false)
    .map((item) => toGridItem(item, byId.get(item.layerId), prefs));
}

export function toGridItem(
  item: ApiItem,
  layer: Layer | undefined,
  prefs: Pick<TimePrefs, 'timeZone' | 'use24h'>,
): GridItem {
  const title = item.title.trim() || NO_TITLE;
  const declined =
    (item.source === 'event' || item.source === 'synced') && item.myReply === 'not-going';
  const shared = {
    id: item.id,
    declined,
    item,
    title,
    color: layer && isColorName(layer.color) ? layer.color : ('default' as const),
  };
  const label = (when: string) =>
    [title, when, layer?.name, declined ? 'Not going' : ''].filter(Boolean).join(', ');

  if (item.allDay) {
    // The API's end date is exclusive; the grid's is the last day.
    const last = addDays(item.end, -1);
    const end = last > item.start ? last : null;
    const days = end ? `${longDate(item.start)} to ${longDate(end)}` : longDate(item.start);
    return { ...shared, allDay: true, start: item.start, end, label: label(`${days}, All day`) };
  }
  const start = toCivil(new Date(item.start), prefs.timeZone);
  const end = toCivil(new Date(item.end), prefs.timeZone);
  return { ...shared, allDay: false, start, end, label: label(describeTimes(start, end, prefs)) };
}

/** "Tuesday, October 27". */
export const longDate = (date: CivilDate): string =>
  formatDate(date, { weekday: 'long', month: 'long', year: false });

/**
 * "Tuesday, October 27, 10:00 to 11:00 AM", "Tuesday, October 27, 10:00 AM" for a point in time,
 * or both dates when it ends on a later day (ending at midnight stays on one day).
 */
export function describeTimes(
  start: CivilDateTime,
  end: CivilDateTime,
  prefs: Pick<TimePrefs, 'use24h'>,
): string {
  const day = longDate(datePart(start));
  if (end <= start) return `${day}, ${formatTime(start, prefs)}`;
  const endDay = datePart(end);
  if (
    endDay === datePart(start) ||
    (end.endsWith('T00:00') && endDay === addDays(datePart(start), 1))
  ) {
    return `${day}, ${formatTimeRange(start, end, prefs)}`;
  }
  return `${day}, ${formatTime(start, prefs)} to ${longDate(endDay)}, ${formatTime(end, prefs)}`;
}
