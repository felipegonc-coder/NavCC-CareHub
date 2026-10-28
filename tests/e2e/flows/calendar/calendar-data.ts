import type { Page } from '@playwright/test';
import { apiFor, DEFAULT_TIME_ZONE } from '../_support/index.js';

// Fictional calendar data, made through the API as the person signed in on the page. Routes and
// fields follow the Calendar API shapes in @carehub/team-calendar-api (#168): everything is under
// /api/calendar, timed events use UTC instants, and `people` are member IDs (any makes a meeting).
// Checks look at the screens; the API only makes data and tries requests the screens don't offer.

export const MINUTE = 60_000;

/** A timed Care Hub event. Times are epoch milliseconds; `people` are member IDs. */
export type NewEvent = {
  title: string;
  start: number;
  end: number;
  videoUrl?: string;
  people?: string[];
};

/** What the API answers for one event (calendarEventSchema), as far as these flows need it. */
export type CalendarEvent = {
  id: string;
  layerId: string;
  title: string;
  start: string;
  end: string;
  people: { id: string; name: string }[];
  notesPageId: string | null;
};

const iso = (at: number) => new Date(at).toISOString();

/** POST /api/calendar/events. Returns the new event's ID. */
export async function createEvent(page: Page, event: NewEvent): Promise<string> {
  const reply = await (
    await apiFor(page)
  ).post<{ event: CalendarEvent }>('/api/calendar/events', {
    title: event.title,
    allDay: false,
    start: iso(event.start),
    end: iso(event.end),
    timeZone: DEFAULT_TIME_ZONE,
    ...(event.videoUrl ? { videoUrl: event.videoUrl } : {}),
    ...(event.people ? { people: event.people } : {}),
  });
  return reply.event.id;
}

/** GET /api/calendar/events/:id */
export async function getEvent(page: Page, id: string): Promise<CalendarEvent> {
  const reply = await (
    await apiFor(page)
  ).get<{ event: CalendarEvent }>(`/api/calendar/events/${id}`);
  return reply.event;
}

/** Moves a (non-repeating) event: PATCH with allDay, start and end together. */
export async function moveEvent(page: Page, id: string, start: number, end: number) {
  await (
    await apiFor(page)
  ).patch(`/api/calendar/events/${id}`, { allDay: false, start: iso(start), end: iso(end) });
}

/** Sets who is invited (PATCH people). */
export async function setPeople(page: Page, id: string, people: string[]) {
  await (await apiFor(page)).patch(`/api/calendar/events/${id}`, { people });
}

/** Deletes an event made by a test. Best effort: it may be gone already. */
export async function deleteEvent(page: Page, id: string): Promise<void> {
  await (await apiFor(page)).send('DELETE', `/api/calendar/events/${id}`).catch(() => undefined);
}

/** One item of GET /api/calendar/items, as far as these flows need it. */
export type CalendarItem = {
  id: string;
  layerId: string;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  /** Care Hub events: the series. */
  eventId?: string;
  /** Google, iCloud and private-link events. */
  syncedEventId?: string;
};

/** Everything on the person's layers from `from` up to `to` (dates, `to` not included). */
export async function itemsBetween(page: Page, from: string, to: string): Promise<CalendarItem[]> {
  const reply = await (
    await apiFor(page)
  ).get<{ items: CalendarItem[] }>(`/api/calendar/items?from=${from}&to=${to}`);
  return reply.items;
}

/** True when a timed item overlaps the moments `from` to `to`. */
export function overlaps(item: CalendarItem, from: number, to: number): boolean {
  return !item.allDay && Date.parse(item.start) < to && Date.parse(item.end) > from;
}

/** Deletes the person's events called `title` from `from`, for `days` days. Best effort. */
export async function deleteByTitle(page: Page, title: string, from: string, to: string) {
  const items = await itemsBetween(page, from, to).catch(() => []);
  for (const item of items) {
    if (item.title === title && item.eventId) await deleteEvent(page, item.eventId);
  }
}

/**
 * The Google test account's primary calendar, through Google Calendar API v3 with its own access
 * token. Only CA-07's by-hand run uses it, to make, change and delete an event in Google.
 */
export function googleCalendar(token: string) {
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Google ${method} ${path} answered ${response.status}`);
    return response.status === 204 ? {} : ((await response.json()) as { id?: string });
  };
  const when = (at: number) => ({ dateTime: iso(at), timeZone: DEFAULT_TIME_ZONE });
  return {
    async create(title: string, start: number, end: number): Promise<string> {
      const made = await call('POST', '', { summary: title, start: when(start), end: when(end) });
      if (!made.id) throw new Error('Google gave no event ID');
      return made.id;
    },
    rename: (id: string, title: string) => call('PATCH', `/${id}`, { summary: title }),
    remove: (id: string) => call('DELETE', `/${id}`),
  };
}
