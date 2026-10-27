// What a notice's event card shows the person reading their 🔔 Care Hub chat. Only the
// organizer and the people invited see the event; a cancelled meeting or occurrence still shows
// them which one it was.
import { RepeatError, describeRepeat, occurrenceAt, type Civil } from '@carehub/team-repeat';
import {
  addDays,
  addMinutes,
  daysBetween,
  formatDate,
  formatTime,
  formatTimeRange,
  isCivilDate,
  minutesBetween,
  toCivil,
  toInstant,
} from '@carehub/team-time';
import type { EventCardRef, EventCardResult, NoticeReader } from '../../notices';
import { shownTitle, type StoredEvent } from './items';
import { seriesOf } from './model';

/** An event as cards need it, cancelled ones included. */
export type CardEvent = StoredEvent & { cancelledAt: Date | null };

const day = (date: string) => formatDate(date, { weekday: 'short', year: false });

/** A civil value in the event's zone as a civil value in the reader's ('YYYY-MM-DD…'). */
const inReaderZone = (value: Civil, timeZone: string, reader: NoticeReader) =>
  isCivilDate(value) ? value : toCivil(toInstant(value, timeZone), reader.timeZone);

/** 'Tue, Oct 28 · 10:00 to 11:00 AM' in the reader's zone, or 'Tue, Oct 28' for all-day ones. */
export function whenText(start: Civil, end: Civil, timeZone: string, reader: NoticeReader) {
  if (isCivilDate(start)) {
    const last = addDays(end.slice(0, 10), -1);
    return last > start ? `${day(start)} to ${day(last)}` : day(start);
  }
  const from = inReaderZone(start, timeZone, reader);
  const to = inReaderZone(end, timeZone, reader);
  if (from.slice(0, 10) === to.slice(0, 10)) {
    return `${day(from.slice(0, 10))} · ${formatTimeRange(from, to, reader)}`;
  }
  const at = (value: string) => `${day(value.slice(0, 10))} · ${formatTime(value, reader)}`;
  return `${at(from)} to ${at(to)}`;
}

/** Where a removed occurrence would have ended: it kept the series' length. */
function endOf(event: CardEvent, key: Civil): Civil {
  if (isCivilDate(key)) return addDays(key, daysBetween(event.start, event.end));
  return addMinutes(key, minutesBetween(event.start, event.end));
}

/** The occurrence for a key, null when it's gone, or undefined when the key never fit. */
function occurrenceOf(event: CardEvent, key: string) {
  const series = seriesOf(event);
  if (!series) return undefined;
  try {
    return occurrenceAt(series, key);
  } catch (error) {
    if (error instanceof RepeatError) return undefined;
    throw error;
  }
}

/** What one card shows this reader. */
export function cardOf(
  event: CardEvent | undefined,
  card: EventCardRef,
  reader: NoticeReader,
): EventCardResult {
  if (!event) return { deleted: true };
  const { id, organizerId, people, timeZone } = event;
  const isOn = organizerId === reader.userId || people.some((p) => p.userId === reader.userId);
  if (!isOn) return { locked: true };
  const title = shownTitle(event.title);
  const key = card.occurrenceStart;
  const cancelled = (start: Civil, end: Civil): EventCardResult => ({
    title,
    when: `Cancelled · ${whenText(start, end, timeZone, reader)}`,
    href: `/calendar?date=${inReaderZone(start, timeZone, reader).slice(0, 10)}`,
  });
  if (key === null || !seriesOf(event)) {
    if (event.cancelledAt) return cancelled(event.start, event.end);
    const when = whenText(event.start, event.end, timeZone, reader);
    const repeat = event.rule ? ` · ${describeRepeat(event.rule, event.start)}` : '';
    return { title, when: `${when}${repeat}`, href: `/calendar?event=${id}` };
  }
  const shown = occurrenceOf(event, key);
  if (shown === undefined) return { deleted: true };
  if (shown && event.cancelledAt) return cancelled(shown.start, shown.end);
  if (shown) {
    const href = `/calendar?event=${id}&occurrence=${encodeURIComponent(key)}`;
    return { title, when: whenText(shown.start, shown.end, timeZone, reader), href };
  }
  // Removed on its own (This event); a key the series no longer has is just gone.
  if (event.cancelledAt || event.exceptions.includes(key)) return cancelled(key, endOf(event, key));
  return { deleted: true };
}
