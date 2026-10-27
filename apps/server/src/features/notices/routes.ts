// The notices plugin: it starts sendNotice for the app. The routes for the 🔔 Care Hub chat come
// in the next part. There's no route that adds a notice: features call sendNotice on the server.
import type { FastifyPluginAsync } from 'fastify';
import { publishToUsers } from '../live';
import './events';
import { bindNoticesRuntime } from './service';
import { createNoticeStore } from './store';

const noticesRoutes: FastifyPluginAsync = async (app) => {
  const unbind = bindNoticesRuntime({
    store: createNoticeStore(app.db),
    emit: (name, payload) => app.events.emit(name, payload),
    publish: publishToUsers,
    onError: (err) => app.log.error({ err }, 'A notice follow-up failed.'),
  });
  app.addHook('onClose', async () => unbind());
};

export default noticesRoutes;
