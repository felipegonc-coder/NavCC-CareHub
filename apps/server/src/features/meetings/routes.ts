// /api/meetings: Take meeting notes (Meetings spec). See README.md.
import { hasPermission } from '@carehub/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { takeNotesSchema } from './domain/notes';
import { takeMeetingNotes } from './service';
import { corePages } from './stand-ins';
import { postgresNotesStore } from './store';
import type { NotesPages, Viewer } from './types';

export interface MeetingsRoutesOptions {
  /** Pages and page content: core's once they're on main (stand-ins.ts). Tests pass their own. */
  pages?: NotesPages | null;
}

/** The member asking. `app.requireMember` has already turned away guests and people outside. */
function viewerOf(request: FastifyRequest): Viewer {
  const { user, member } = request;
  if (!user) throw httpError(401, 'signed_out');
  if (!member || member.kind !== 'member') throw httpError(403, 'forbidden');
  const canCreatePages = hasPermission(member, 'pages.create');
  return { userId: user.id, workspaceId: member.workspaceId, canCreatePages };
}

const meetingsRoutes: FastifyPluginAsync<MeetingsRoutesOptions> = async (app, options) => {
  const deps = { store: postgresNotesStore, pages: options.pages ?? corePages };

  // Take meeting notes: 201 with the new notes, 200 with the ones already there. IDs only.
  app.post('/notes', { preHandler: app.requireMember }, async (request, reply) => {
    const viewer = viewerOf(request);
    const input = takeNotesSchema.parse(request.body);
    const { notes, created } = await takeMeetingNotes(app.db, deps, viewer, input);
    return reply.code(created ? 201 : 200).send({ notes: { id: notes.id, pageId: notes.pageId } });
  });
};

export default meetingsRoutes;
