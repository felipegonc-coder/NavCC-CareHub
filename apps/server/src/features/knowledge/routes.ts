// /api/knowledge: knowledge base extras on wiki databases (Knowledge base spec; decision 0400).
// Open tabs of a knowledge base page hear `knowledge.changed` on `knowledge:<pageId>`. Reports are
// private, so their `knowledge.reports` events go only to the people they concern.
import {
  replyInputSchema,
  reportInputSchema,
  reportStatusInputSchema,
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
import { publishToUsers, publishTopic, registerTopic } from '../live';
import { deliverNotices } from './notices';
import { registerRowAccessLimiter } from './ports';
import {
  addReply,
  baseReports,
  createReport,
  myReports,
  reportDetail,
  setReportStatus,
  type ReportChange,
} from './reports';
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
import { testHooksOn } from './test-hooks';

const TOPIC = 'knowledge';
const pageParams = z.object({ pageId: z.uuid() });
const baseParams = z.object({ databaseId: z.uuid() });
const reportParams = z.object({ reportId: z.uuid() });
const reportsQuery = z.object({ status: z.enum(['open', 'all']).default('open') });

function userOf(request: FastifyRequest): CurrentUser {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  // The e2e test hook (test-hooks.ts): "Verify until a date" also takes today and earlier days.
  const pastDates = testHooksOn({ log: app.log });
  if (pastDates) {
    app.log.warn(
      'Knowledge base: the e2e test hook is on (CAREHUB_TEST_HOOKS=1), so verify dates may be in the past. Never in production.',
    );
  }
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
  /** After the commit: the notices, then a refresh for the people the report concerns. */
  async function sent<T>(request: FastifyRequest, change: ReportChange<T>) {
    await deliverNotices(change.notices, request.log);
    publishToUsers(change.notify, { type: 'knowledge.reports', data: { pageId: change.pageId } });
    return change.result;
  }

  app.get('/pages/:pageId', async (request) => {
    const { pageId } = pageParams.parse(request.params);
    return pageInfo(app.db, userOf(request), pageId);
  });

  app.post('/pages/:pageId/verification', async (request) => {
    const { pageId } = pageParams.parse(request.params);
    const input = verifyInputSchema.parse(request.body);
    if (pastDates && input.period === 'date') {
      request.log.info({ pageId, until: input.until }, 'Knowledge base test hook: verify until');
    }
    const info = await verifyPage(app.db, userOf(request), pageId, input, { pastDates });
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

  app.post('/pages/:pageId/reports', async (request, reply) => {
    const { pageId } = pageParams.parse(request.params);
    const input = reportInputSchema.parse(request.body);
    const change = await createReport(app.db, userOf(request), pageId, input);
    return reply.code(201).send(await sent(request, change));
  });

  app.get('/pages/:pageId/reports/mine', async (request) => {
    const { pageId } = pageParams.parse(request.params);
    return { reports: await myReports(app.db, userOf(request), pageId) };
  });

  app.get('/bases/:databaseId/reports', async (request) => {
    const { databaseId } = baseParams.parse(request.params);
    const { status } = reportsQuery.parse(request.query);
    return { reports: await baseReports(app.db, userOf(request), databaseId, status) };
  });

  app.get('/reports/:reportId', async (request) => {
    const { reportId } = reportParams.parse(request.params);
    return reportDetail(app.db, userOf(request), reportId);
  });

  app.post('/reports/:reportId/replies', async (request, reply) => {
    const { reportId } = reportParams.parse(request.params);
    const { text } = replyInputSchema.parse(request.body);
    const change = await addReply(app.db, userOf(request), reportId, text);
    return reply.code(201).send(await sent(request, change));
  });

  app.patch('/reports/:reportId', async (request) => {
    const { reportId } = reportParams.parse(request.params);
    const { status } = reportStatusInputSchema.parse(request.body);
    const change = await setReportStatus(app.db, userOf(request), reportId, status);
    return sent(request, change);
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
