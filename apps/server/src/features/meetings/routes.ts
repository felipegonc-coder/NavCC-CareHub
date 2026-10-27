// /api/meetings: Take meeting notes (Meetings spec). See README.md.
import type { FastifyPluginAsync } from 'fastify';
import { takeNotesSchema } from './domain/notes';
import { takeMeetingNotes } from './service';
import { corePages, viewerOf } from './stand-ins';
import { postgresNotesStore } from './store';
import type { NotesPages } from './types';

export interface MeetingsRoutesOptions {
  /** Pages and page content: core's once they're on main (stand-ins.ts). Tests pass their own. */
  pages?: NotesPages | null;
}

const meetingsRoutes: FastifyPluginAsync<MeetingsRoutesOptions> = async (app, options) => {
  const deps = { store: postgresNotesStore, pages: options.pages ?? corePages };

  // Take meeting notes: 201 with the new notes, 200 with the ones already there. IDs only.
  app.post('/notes', async (request, reply) => {
    const viewer = viewerOf(request);
    const input = takeNotesSchema.parse(request.body);
    const { notes, created } = await takeMeetingNotes(app.db, deps, viewer, input);
    return reply.code(created ? 201 : 200).send({ notes: { id: notes.id, pageId: notes.pageId } });
  });
};

export default meetingsRoutes;
