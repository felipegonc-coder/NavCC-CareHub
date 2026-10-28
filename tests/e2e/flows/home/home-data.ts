import type { Page } from '@playwright/test';
import { apiFor, DEFAULT_TIME_ZONE } from '../_support/index.js';

// Fictional data for the Home flows, made through the API as the person signed in on the page.
// Pages and spaces follow decision 0007 (section 4.1) and databases decision 0200. Events follow
// the Calendar API shapes in @carehub/team-calendar-api (#168), only in createEvent and deleteEvent.

/** A reply that is the thing itself or wraps it, such as { page: { … } }. */
function unwrap<T>(reply: unknown, key: string): T {
  if (typeof reply === 'object' && reply !== null && key in reply) {
    return (reply as Record<string, unknown>)[key] as T;
  }
  return reply as T;
}

/** A fictional page in the person's private space. Returns its ID. */
export async function createPage(page: Page, title: string): Promise<string> {
  type Space = { id: string; kind?: string; type?: string; name?: string };
  const api = await apiFor(page);
  const reply = await api.get('/api/spaces');
  const spaces = (Array.isArray(reply) ? reply : unwrap(reply, 'spaces')) as Space[];
  const own = spaces.find((space) =>
    /private/i.test(`${space.kind ?? space.type ?? ''} ${space.name ?? ''}`),
  );
  const made = await api.post('/api/pages', { spaceId: own?.id, kind: 'page', title });
  const id = unwrap<{ id?: string }>(made, 'page').id;
  if (!id) throw new Error(`POST /api/pages gave no page ID: ${JSON.stringify(made)}`);
  return id;
}

/** A timed event on the person's own calendar (My events). Times are epoch milliseconds. */
export type FictionalEvent = { title: string; start: number; end: number; videoLink?: string };

export async function createEvent(page: Page, event: FictionalEvent): Promise<string> {
  const made = await (
    await apiFor(page)
  ).post('/api/calendar/events', {
    title: event.title,
    allDay: false,
    start: new Date(event.start).toISOString(),
    end: new Date(event.end).toISOString(),
    timeZone: DEFAULT_TIME_ZONE,
    ...(event.videoLink ? { videoUrl: event.videoLink } : {}),
  });
  const id = unwrap<{ id?: string }>(made, 'event').id;
  if (!id) throw new Error(`POST /api/calendar/events gave no event ID: ${JSON.stringify(made)}`);
  return id;
}

/** Deletes an event made by a test, so a retry starts with a clean Upcoming. Best effort. */
export async function deleteEvent(page: Page, id: string): Promise<void> {
  await (await apiFor(page)).delete(`/api/calendar/events/${id}`).catch(() => undefined);
}

/** A "Tickets" task database: a Person, a date and a Checkbox property (Home spec, section 2). */
export type Tickets = { id: string; title: string; assignee: string; due: string; done: string };

type Property = { id: string; name: string };

async function addProperty(
  page: Page,
  databaseId: string,
  name: string,
  config: Record<string, unknown>,
): Promise<string> {
  const reply = await (
    await apiFor(page)
  ).post(`/api/databases/${databaseId}/properties`, { name, config });
  const made = unwrap<Property | { properties: Property[] }>(reply, 'property');
  const property = 'properties' in made ? made.properties.find((p) => p.name === name) : made;
  if (!property) throw new Error(`Adding "${name}" gave no property: ${JSON.stringify(reply)}`);
  return property.id;
}

/** A full-page database in a new private page, with Assignee, Due and Done. */
export async function createTickets(page: Page, title: string): Promise<Tickets> {
  const parentId = await createPage(page, `${title} home`);
  const reply = await (
    await apiFor(page)
  ).post('/api/databases', { parentId, inline: false, title });
  const { id } = unwrap<{ id: string }>(reply, 'database');
  return {
    id,
    title,
    assignee: await addProperty(page, id, 'Assignee', {
      type: 'person',
      single: false,
      notify: false,
    }),
    due: await addProperty(page, id, 'Due', { type: 'date', format: 'full', timeFormat: 'viewer' }),
    done: await addProperty(page, id, 'Done', { type: 'checkbox' }),
  };
}

/** An open row assigned to `userId`, due on `due` (YYYY-MM-DD). Returns the row's ID. */
export async function addTicket(
  page: Page,
  tickets: Tickets,
  title: string,
  userId: string,
  due: string,
): Promise<string> {
  const reply = await (
    await apiFor(page)
  ).post(`/api/databases/${tickets.id}/rows`, {
    title,
    values: {
      [tickets.assignee]: [userId],
      [tickets.due]: { start: due, end: null, hasTime: false },
    },
  });
  return unwrap<{ id: string }>(reply, 'row').id;
}
