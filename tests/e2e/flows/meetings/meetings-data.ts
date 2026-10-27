import type { Page } from '@playwright/test';
import { apiFor, DEFAULT_TIME_ZONE } from '../_support/index.js';

// Fictional events for the Meetings flows, made through the Calendar API as the person signed in
// on the page (shapes from @carehub/team-calendar-api, #168). Meeting notes have no documented
// route yet, so the flows make them on screen with Take meeting notes, as people do.

export const MINUTE = 60_000;

/** A workspace member, as GET /api/workspace/members lists them (decision 0007, section 4.1). */
export type Member = { id: string; name: string; email: string };

/** The member with this email, looked up as the person on `page`. */
export async function member(page: Page, email: string): Promise<Member> {
  const reply = await (
    await apiFor(page)
  ).get<Member[] | { members: Member[] }>(`/api/workspace/members?q=${encodeURIComponent(email)}`);
  const found = (Array.isArray(reply) ? reply : reply.members).find((m) => m.email === email);
  if (!found) throw new Error(`No workspace member ${email}`);
  return found;
}

/** A timed Care Hub event; any `people` (member IDs) make it a meeting. Epoch milliseconds. */
export type NewEvent = {
  title: string;
  start: number;
  end: number;
  videoUrl?: string;
  people?: string[];
};

/** POST /api/calendar/events. Returns the new event's ID. */
export async function createEvent(page: Page, event: NewEvent): Promise<string> {
  const reply = await (
    await apiFor(page)
  ).post<{ event: { id: string } }>('/api/calendar/events', {
    title: event.title,
    allDay: false,
    start: new Date(event.start).toISOString(),
    end: new Date(event.end).toISOString(),
    timeZone: DEFAULT_TIME_ZONE,
    ...(event.videoUrl ? { videoUrl: event.videoUrl } : {}),
    ...(event.people ? { people: event.people } : {}),
  });
  return reply.event.id;
}

/** The event's notes page, if it has one (GET /api/calendar/events/:id, `notesPageId`). */
export async function notesPageOf(page: Page, id: string): Promise<string | null> {
  const reply = await (
    await apiFor(page)
  ).get<{ event: { notesPageId: string | null } }>(`/api/calendar/events/${id}`);
  return reply.event.notesPageId;
}

/** Sets who is invited to an event (PATCH people), as its organizer. */
export async function setPeople(page: Page, id: string, people: string[]): Promise<void> {
  await (await apiFor(page)).patch(`/api/calendar/events/${id}`, { people });
}

/** Deletes an event made by a test. Best effort: it may be gone already. */
export async function deleteEvent(page: Page, id: string): Promise<void> {
  await (await apiFor(page)).send('DELETE', `/api/calendar/events/${id}`).catch(() => undefined);
}

/** The status of GET /api/pages/:id for the person on `page` (403 without access). */
export async function pageStatus(page: Page, id: string): Promise<number> {
  return (await (await apiFor(page)).send('GET', `/api/pages/${id}`)).status();
}
