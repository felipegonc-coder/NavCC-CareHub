import type { FastifyPluginAsync } from 'fastify';
import { startCollabServer } from './server';

export interface CollabRoutesOptions {
  /** CAREHUB_VERSION, which editors must match. */
  version: string;
  /** CAREHUB_PUBLIC_URL, if set. */
  publicUrl?: string | undefined;
}

/** /api/collab: the WebSocket for live co-editing, served by Hocuspocus (decision 0007, 4.2). */
const collabRoutes: FastifyPluginAsync<CollabRoutesOptions> = async (app, options) => {
  startCollabServer(app, {
    path: app.prefix,
    build: options.version,
    publicUrl: options.publicUrl,
  });
};

export default collabRoutes;
