// /api/meetings: Take meeting notes (Meetings spec). See README.md.
import { hasPermission } from '@carehub/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { perMinuteLimit } from './domain/limit';
import { takeNotesSchema } from './domain/notes';
import { takeMeetingNotes } from './service';
import { notesCore } from './stand-ins';
import { postgresNotesStore } from './store';
import transcriptsRoutes from './transcripts/routes';
import type { NotesCore, Viewer } from './types';

/** Take meeting notes calls a minute for each person: one can make two pages and many grants. */
const NOTES_PER_MINUTE = 20;

export interface MeetingsRoutesOptions {
  /** Pages, page content and memberships: core's once on main (stand-ins.ts). Tests pass theirs. */
  core?: NotesCore | null;
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
  const deps = { store: postgresNotesStore, core: options.core ?? notesCore };
  const limit = perMinuteLimit(NOTES_PER_MINUTE);

  // Take meeting notes: 201 with the new notes, 200 with the ones already there. IDs only.
  app.post('/notes', { preHandler: app.requireMember }, async (request, reply) => {
    const viewer = viewerOf(request);
    if (!limit.allow(viewer.userId)) throw httpError(429, 'rate_limited');
    const input = takeNotesSchema.parse(request.body);
    const { notes, created } = await takeMeetingNotes(app.db, deps, viewer, input);
    return reply.code(created ? 201 : 200).send({ notes: { id: notes.id, pageId: notes.pageId } });
  });

  // Private transcription: the speech model files.
  await app.register(transcriptsRoutes);
};

export default meetingsRoutes;
