// /api/knowledge: knowledge base extras on wiki databases (Knowledge base spec; decision 0400).
// Open tabs of a knowledge base page hear `knowledge.changed` on `knowledge:<pageId>`. Reports are
// private, so their `knowledge.reports` events go only to the people they concern. Expiry, the
// Monday summary and Editing removes verification run in the jobs runner.
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
import type { EventBus } from '../../core/events';
import type { Db } from '../../db';
import { registerPeriodicTask } from '../jobs';
import { publishToUsers, publishTopic, registerTopic } from '../live';
import { deliverNotices, type KbNotice } from './notices';
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
  baseHealth,
  expireDuePages,
  ownerLeft,
  removeEditedVerifications,
  sendSummaries,
} from './reviews';
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
const reportParams = z.object({ reportId: z.uuid() });
const reportsQuery = z.object({ status: z.enum(['open', 'all']).default('open') });
const memberRemoved = z.object({ workspaceId: z.uuid(), userId: z.uuid() });
const MINUTE_MS = 60_000;

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
  // Each run sends its notices after its writes; a failed run waits for the next slot.
  const every = (name: string, minutes: number, run: (db: Db) => Promise<KbNotice[]>) =>
    registerPeriodicTask(name, minutes * MINUTE_MS, async () => {
      await deliverNotices(await run(app.db), app.log);
    });
  every('knowledge.expiry', 1, (db) => expireDuePages(db));
  every('knowledge.summaries', 5, (db) => sendSummaries(db));
  every('knowledge.edits', 1, (db) => removeEditedVerifications(db));
  // stand-in: core's `member.removed` event (decision 0007, section 2.4), typed once it's declared.
  const events = app.events as unknown as EventBus<Record<'member.removed', unknown>>;
  const off = events.on('member.removed', async (payload) => {
    const parsed = memberRemoved.safeParse(payload);
    if (!parsed.success) return;
    const { workspaceId, userId } = parsed.data;
    await deliverNotices(await ownerLeft(app.db, workspaceId, userId), app.log);
  });
  app.addHook('onClose', async () => off());
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

  app.get('/bases/:databaseId/health', async (request) => {
    const { databaseId } = baseParams.parse(request.params);
    return baseHealth(app.db, userOf(request), databaseId);
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
