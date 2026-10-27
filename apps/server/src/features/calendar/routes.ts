import {
  createEventSchema,
  deleteEventQuerySchema,
  duplicateSchema,
  editEventSchema,
  itemsQuerySchema,
  layerPatchSchema,
  replyBodySchema,
  settingsPatchSchema,
  upcomingQuerySchema,
} from '@carehub/team-calendar-api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { registerNoticeCardResolver } from '../notices';
import { registerEventLookup } from '../reminders';
import {
  createEvent,
  deleteEvent,
  duplicateEvent,
  editEvent,
  eventCards,
  getEvent,
  listItems,
  listUpcoming,
  onNoticeError,
  replyToEvent,
  type Viewer,
} from './events/service';
import { lookupStart, onReminderError } from './events/reminders';
import { changeLayer, listLayers } from './layers/service';
import { changeSettings, getSettings } from './settings/service';

/** The signed-in member (after requireMember) with what Calendar needs. */
function viewerOf(request: FastifyRequest): Viewer {
  const { user, member } = request;
  if (!user) throw httpError(401, 'signed_out');
  if (!member) throw httpError(403, 'forbidden');
  const { id, name, timeZone, use24h } = user;
  return { id, workspaceId: member.workspaceId, name, timeZone, use24h };
}

type EventParams = { Params: { eventId: string } };
type LayerParams = { Params: { layerId: string } };

/** Care Hub's own calendars. Every role can use Calendar (Calendar spec, section 5), not guests. */
async function careHubCalendar(app: FastifyInstance) {
  app.addHook('preHandler', app.requireMember);

  app.get('/items', async (request) =>
    listItems(app.db, viewerOf(request), itemsQuerySchema.parse(request.query)),
  );

  app.get('/upcoming', async (request) =>
    listUpcoming(app.db, viewerOf(request), upcomingQuerySchema.parse(request.query)),
  );

  app.post('/events', async (request, reply) => {
    const event = await createEvent(
      app.db,
      viewerOf(request),
      createEventSchema.parse(request.body),
    );
    return reply.code(201).send({ event });
  });

  app.get<EventParams>('/events/:eventId', async (request) => ({
    event: await getEvent(app.db, viewerOf(request), request.params.eventId),
  }));

  app.patch<EventParams>('/events/:eventId', async (request) =>
    editEvent(
      app.db,
      viewerOf(request),
      request.params.eventId,
      editEventSchema.parse(request.body),
    ),
  );

  app.delete<EventParams>('/events/:eventId', async (request, reply) => {
    const query = deleteEventQuerySchema.parse(request.query);
    await deleteEvent(app.db, viewerOf(request), request.params.eventId, query);
    return reply.code(204).send();
  });

  app.put<EventParams>('/events/:eventId/reply', async (request, reply) => {
    const body = replyBodySchema.parse(request.body);
    await replyToEvent(app.db, viewerOf(request), request.params.eventId, body);
    return reply.code(204).send();
  });

  app.post('/duplicate', async (request, reply) => {
    const event = await duplicateEvent(
      app.db,
      viewerOf(request),
      duplicateSchema.parse(request.body),
    );
    return reply.code(201).send({ event });
  });

  app.get('/layers', async (request) => listLayers(app.db, viewerOf(request)));

  app.patch<LayerParams>('/layers/:layerId', async (request) =>
    changeLayer(
      app.db,
      viewerOf(request),
      request.params.layerId,
      layerPatchSchema.parse(request.body),
    ),
  );

  app.get('/settings', async (request) => ({
    settings: await getSettings(app.db, viewerOf(request)),
  }));

  app.patch('/settings', async (request) => ({
    settings: await changeSettings(
      app.db,
      viewerOf(request),
      settingsPatchSchema.parse(request.body),
    ),
  }));
}

/** Calendar routes under /api/calendar. */
export default async function calendarRoutes(app: FastifyInstance) {
  // Remind me in the event panel asks Calendar when an event starts, and the 🔔 Care Hub chat
  // asks what the event cards under Calendar's notices show.
  registerEventLookup(lookupStart);
  onReminderError((error) => app.log.error({ err: error }, "Calendar couldn't change a reminder"));
  registerNoticeCardResolver('event', eventCards);
  onNoticeError((error) => app.log.error({ err: error }, "A Calendar notice wasn't sent"));
  app.addHook('onClose', async () => {
    registerEventLookup(null);
    registerNoticeCardResolver('event', null);
  });

  // A plugin of its own, so its guard doesn't apply to the routes registered after it.
  await app.register(careHubCalendar);

  // calendar: connections
}
