// /api/knowledge: knowledge base extras on wiki databases (Knowledge base spec; decision 0400).
// Open tabs of a knowledge base page hear `knowledge.changed` on `knowledge:<pageId>`.
import {
  reviewInputSchema,
  settingsInputSchema,
  statusInputSchema,
  verifyInputSchema,
  ownersInputSchema,
  wikiRowLimiter,
} from '@carehub/extras/knowledge';
import type { CurrentUser } from '@carehub/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { publishTopic, registerTopic } from '../live';
import { registerRowAccessLimiter } from './ports';
import {
  getSettings,
  openPage,
  pageInfo,
  removeVerification,
  reviewPage,
  setOwners,
  setStatus,
  updateSettings,
  verifyPage,
} from './service';

const TOPIC = 'knowledge';
const pageParams = z.object({ pageId: z.uuid() });
const baseParams = z.object({ databaseId: z.uuid() });

function userOf(request: FastifyRequest): CurrentUser {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  // Drafts (KB-03): only owners and editors see them, everywhere rows show up.
  registerRowAccessLimiter('wiki', wikiRowLimiter);
  registerTopic(TOPIC, async ({ userId, topic }) => {
    const pageId = topic.slice(TOPIC.length + 1);
    return openPage(app.db, userId, pageId).then(
      () => true,
      () => false,
    );
  });
  const changed = (pageId: string) =>
    publishTopic(`${TOPIC}:${pageId}`, { type: 'knowledge.changed', data: { pageId } });

  app.get('/pages/:pageId', async (request) => {
    const { pageId } = pageParams.parse(request.params);
    return pageInfo(app.db, userOf(request), pageId);
  });

  app.post('/pages/:pageId/verification', async (request) => {
    const { pageId } = pageParams.parse(request.params);
    const input = verifyInputSchema.parse(request.body);
    const info = await verifyPage(app.db, userOf(request), pageId, input);
    changed(pageId);
    return info;
  });

  app.delete('/pages/:pageId/verification', async (request) => {
    const { pageId } = pageParams.parse(request.params);
    const info = await removeVerification(app.db, userOf(request), pageId);
    changed(pageId);
    return info;
  });

  app.put('/pages/:pageId/status', async (request) => {
    const { pageId } = pageParams.parse(request.params);
    const { status } = statusInputSchema.parse(request.body);
    const info = await setStatus(app.db, userOf(request), pageId, status);
    changed(pageId);
    return info;
  });

  app.put('/pages/:pageId/owners', async (request) => {
    const { pageId } = pageParams.parse(request.params);
    const { owners } = ownersInputSchema.parse(request.body);
    const info = await setOwners(app.db, userOf(request), pageId, owners);
    changed(pageId);
    return info;
  });

  app.post('/pages/:pageId/review', async (request, reply) => {
    const { pageId } = pageParams.parse(request.params);
    const { action } = reviewInputSchema.parse(request.body);
    const info = await reviewPage(app.db, userOf(request), pageId, action);
    changed(pageId);
    return info ? info : reply.code(204).send();
  });

  app.get('/bases/:databaseId/settings', async (request) => {
    const { databaseId } = baseParams.parse(request.params);
    return getSettings(app.db, userOf(request).id, databaseId);
  });

  app.patch('/bases/:databaseId/settings', async (request) => {
    const { databaseId } = baseParams.parse(request.params);
    const patch = settingsInputSchema.parse(request.body);
    return updateSettings(app.db, userOf(request).id, databaseId, patch);
  });
};

export default knowledgeRoutes;
