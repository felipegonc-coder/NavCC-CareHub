import {
  CreateReviewCommentRequestSchema,
  CreateReviewLinkRequestSchema,
  IdSchema,
  REVIEW_TOKEN_HEADER,
  UpdateReviewCommentRequestSchema,
} from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { registerPeriodicTask } from '../../jobs';
import { requirePermission, viewerOf } from '../auth';
import { parseInput } from '../errors';
import { REVIEW_REMINDERS_TASK, sendReviewReminders } from './reminders';
import * as reviews from './service';

const IdParams = z.object({ id: IdSchema });
const LinkParams = z.object({ linkId: IdSchema });
const TOKEN_HEADER = REVIEW_TOKEN_HEADER.toLowerCase();
const HOUR_MS = 60 * 60 * 1000;

// Reviews (B1): review links and comments in Studio (learning.build), and the review itself for any signed-in
// member with a link, whose token comes in the X-Review-Token header (decision 0309). Endpoints in
// docs/learning/api.md. Replies that carry a token or a draft are never cached. Review-due reminders go out
// every hour (decision 0313).
const reviewsRoutes: FastifyPluginAsync = async (app) => {
  registerPeriodicTask(REVIEW_REMINDERS_TASK, HOUR_MS, async ({ signal }) => {
    await sendReviewReminders(app.db, { signal });
  });
  const build = { preHandler: requirePermission('learning.build') };
  const idOf = (request: FastifyRequest) => parseInput(IdParams, request.params).id;
  const tokenOf = (request: FastifyRequest) => request.headers[TOKEN_HEADER];

  app.post('/studio/courses/:id/review-links', build, async (request, reply) => {
    const input = parseInput(CreateReviewLinkRequestSchema, request.body ?? {});
    const link = await reviews.createReviewLink(app.db, viewerOf(request), idOf(request), input);
    return reply.code(201).header('cache-control', 'no-store').send(link);
  });
  app.get('/studio/courses/:id/review-links', build, async (request) =>
    reviews.listReviewLinks(app.db, viewerOf(request), idOf(request)),
  );
  app.delete('/studio/review-links/:linkId', build, async (request, reply) => {
    const { linkId } = parseInput(LinkParams, request.params);
    await reviews.stopReviewLink(app.db, viewerOf(request), linkId);
    return reply.code(204).send();
  });

  app.get('/review', async (request, reply) => {
    const review = await reviews.openReview(app.db, viewerOf(request), tokenOf(request));
    return reply.header('cache-control', 'no-store').send(review);
  });
  app.post('/review/comments', async (request, reply) => {
    const viewer = viewerOf(request);
    const input = parseInput(CreateReviewCommentRequestSchema, request.body);
    const comment = await reviews.addReviewComment(app.db, viewer, tokenOf(request), input);
    return reply.code(201).send(comment);
  });

  app.get('/studio/courses/:id/comments', build, async (request) =>
    reviews.listReviewComments(app.db, viewerOf(request), idOf(request)),
  );
  app.get('/studio/courses/:id/comments.csv', build, async (request, reply) => {
    const id = idOf(request);
    const csv = await reviews.reviewCommentsCsvFor(app.db, viewerOf(request), id);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="review-comments-${id}.csv"`)
      .header('cache-control', 'no-store')
      .send(csv);
  });
  app.patch('/studio/comments/:id', build, async (request) => {
    const { resolved } = parseInput(UpdateReviewCommentRequestSchema, request.body);
    return reviews.setCommentResolved(app.db, viewerOf(request), idOf(request), resolved);
  });
};

export default reviewsRoutes;
