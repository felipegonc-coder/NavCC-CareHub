import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LiveHub } from './domain/hub';
import { liveHub } from './index';
import { openLiveStream } from './sse';

export interface LiveRoutesOptions {
  /** The signed-in user's id, or null (401). Until `request.user` lands, app.ts passes this in. */
  getUserId: (
    request: FastifyRequest,
  ) => string | null | undefined | Promise<string | null | undefined>;
  /** Defaults to the app-wide hub. */
  hub?: LiveHub;
}

const topicList = z.array(z.string().min(1).max(200)).max(50);
const topicsBody = z.object({
  connectionId: z.string().min(1).max(100),
  add: topicList.optional(),
  remove: topicList.optional(),
});

/** Sends the shared error shape, `{ error: { code, message, details? } }`. */
function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  return reply
    .code(status)
    .send({ error: { code, message, ...(details === undefined ? {} : { details }) } });
}

const SIGNED_OUT = 'Sign in to continue.';

/** `GET /` is the event stream (one per tab); `POST /topics` adds and removes topics. */
const liveRoutes: FastifyPluginAsync<LiveRoutesOptions> = async (app, options) => {
  const hub = options.hub ?? liveHub;
  hub.setLogger(app.log);
  // Open streams would keep the server from closing.
  app.addHook('preClose', (done) => {
    hub.closeAll();
    done();
  });
  // Someone taken out of the workspace loses their open streams at once; reconnecting is refused.
  // (Unit tests may build the routes without app.events.)
  if (app.hasDecorator('events')) {
    const off = app.events.on('member.removed', ({ userId }) => hub.disconnectUser(userId));
    app.addHook('onClose', async () => off());
  }

  app.get('/', async (request, reply) => {
    const userId = await options.getUserId(request);
    if (!userId) return sendError(reply, 401, 'signed_out', SIGNED_OUT);
    reply.hijack();
    openLiveStream(hub, userId, reply.raw);
    return reply;
  });

  app.post('/topics', async (request, reply) => {
    const userId = await options.getUserId(request);
    if (!userId) return sendError(reply, 401, 'signed_out', SIGNED_OUT);
    const body = topicsBody.safeParse(request.body);
    if (!body.success) {
      return sendError(
        reply,
        400,
        'invalid',
        'Send a connectionId and lists of topics.',
        body.error.issues,
      );
    }
    const result = await hub.updateTopics({ userId, ...body.data });
    // Ended, or someone else's: the client opens a new stream.
    if (!result)
      return sendError(reply, 404, 'not_found', 'This was deleted, or the link is wrong.');
    return result;
  });
};

export default liveRoutes;
