import type { FastifyInstance } from 'fastify';
import { startCollabServer } from './server';

/** Live co-editing: the WebSocket endpoint at /api/collab, served by Hocuspocus. */
export default async function collabRoutes(app: FastifyInstance): Promise<void> {
  startCollabServer(app, app.prefix);
}
