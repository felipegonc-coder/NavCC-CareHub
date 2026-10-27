// /api/history: versions, Updates and Archive. Extras lane (decision 0400, docs/extras/history.md).
// Versions need Can edit on the page; restoring and naming also need it unlocked and not archived;
// Updates need Can view (HT-15). Open Version history windows hear `history.versions` and
// `history.restored` on the live topic `history:<pageId>` (Can edit needed).
import {
  nameVersionSchema,
  saveVersionSchema,
  updateListQuerySchema,
  versionListQuerySchema,
  type SavedVersionResponse,
  type UpdateListResponse,
  type VersionListResponse,
  type VersionResponse,
} from '@carehub/extras/history';
import { atLeast } from '@carehub/shared';
import type { FastifyPluginAsync } from 'fastify';
import { httpError } from '../../core/errors';
import { publishTopic, registerTopic } from '../live';
import { assertCanChange, canChange, idParam, isId, pageFor, userIdOf } from './access';
import type { VersionRestoredEvent } from './events';
import { historyPages } from './pages';
import { getVersion, listVersions, nameVersion, restoreVersion, versionSummary } from './service';
import { startHistoryTracking, TOPIC, versionsChanged } from './tracker';
import { listUpdates } from './updateList';
import { saveBeforeVersion } from './versions';

type LooseEvents = { emit(name: string, payload: unknown): void };

const historyRoutes: FastifyPluginAsync = async (app) => {
  startHistoryTracking(app);
  registerTopic(TOPIC, async ({ userId, topic }) => {
    const pageId = topic.slice(TOPIC.length + 1);
    if (!isId(pageId)) return false;
    const page = await historyPages().getPage(app.db, pageId);
    if (!page || page.trashed) return false;
    return atLeast(await historyPages().getPageAccess(app.db, userId, pageId), 'edit');
  });

  const pageIdOf = (params: unknown) => idParam((params as { pageId?: unknown }).pageId);
  const idsOf = (params: unknown) => ({
    pageId: pageIdOf(params),
    versionId: idParam((params as { versionId?: unknown }).versionId),
  });

  app.get('/pages/:pageId/versions', async (request) => {
    const pageId = pageIdOf(request.params);
    const page = await pageFor(app.db, userIdOf(request), pageId, 'edit');
    const query = versionListQuerySchema.parse(request.query);
    const body: VersionListResponse = {
      ...(await listVersions(app.db, pageId, query)),
      canRestore: canChange(page),
    };
    return body;
  });

  app.get('/pages/:pageId/versions/:versionId', async (request) => {
    const { pageId, versionId } = idsOf(request.params);
    const page = await pageFor(app.db, userIdOf(request), pageId, 'edit');
    const body: VersionResponse = {
      ...(await getVersion(app.db, pageId, versionId)),
      canRestore: canChange(page),
    };
    return body;
  });

  // A version the editor asks for right before Replace all or Accept all (HT-02).
  app.post('/pages/:pageId/versions', async (request, reply) => {
    const pageId = pageIdOf(request.params);
    const by = userIdOf(request);
    assertCanChange(await pageFor(app.db, by, pageId, 'edit'));
    const { reason } = saveVersionSchema.parse(request.body);
    const saved = await saveBeforeVersion(app.db, pageId, { reason, by, skipIfUnchanged: true });
    if (!saved) throw httpError(404, 'not_found');
    versionsChanged(pageId);
    const body: SavedVersionResponse = { version: await versionSummary(app.db, pageId, saved.id) };
    return reply.code(201).send(body);
  });

  app.patch('/pages/:pageId/versions/:versionId', async (request) => {
    const { pageId, versionId } = idsOf(request.params);
    const by = userIdOf(request);
    assertCanChange(await pageFor(app.db, by, pageId, 'edit'));
    const { name } = nameVersionSchema.parse(request.body);
    const version = await nameVersion(app.db, pageId, versionId, name, by);
    versionsChanged(pageId);
    const body: SavedVersionResponse = { version };
    return body;
  });

  app.post('/pages/:pageId/versions/:versionId/restore', async (request) => {
    const { pageId, versionId } = idsOf(request.params);
    const by = userIdOf(request);
    const page = await pageFor(app.db, by, pageId, 'edit');
    assertCanChange(page);
    const { saved, restoredVersionId } = await restoreVersion(app.db, page, versionId, by);
    // Open editors merge the new content (content API, #200); core declares page.updated.
    (app.events as unknown as LooseEvents).emit('page.updated', {
      pageId,
      by,
      content: true,
      source: 'history.restore',
    });
    const event: VersionRestoredEvent = {
      pageId,
      workspaceId: page.workspaceId,
      versionId: saved.id,
      restoredVersionId,
      by,
    };
    app.events.emit('history.version.restored', event);
    publishTopic(`${TOPIC}:${pageId}`, {
      type: 'history.restored',
      data: { pageId, versionId: saved.id },
    });
    const body: SavedVersionResponse = { version: saved };
    return body;
  });

  // The Updates panel (HT-08): viewers see who did what and when; Show changes needs Can edit.
  app.get('/pages/:pageId/updates', async (request) => {
    const pageId = pageIdOf(request.params);
    const userId = userIdOf(request);
    await pageFor(app.db, userId, pageId, 'view');
    const query = updateListQuerySchema.parse(request.query);
    const level = await historyPages().getPageAccess(app.db, userId, pageId);
    const body: UpdateListResponse = await listUpdates(app.db, userId, pageId, {
      ...query,
      canSeeChanges: atLeast(level, 'edit'),
    });
    return body;
  });
};

export default historyRoutes;
