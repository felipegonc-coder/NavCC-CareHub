import {
  CreateBankRequestSchema,
  IdSchema,
  ImportQuestionsRequestSchema,
  QUESTION_CSV_MAX_CHARACTERS,
  SaveBankRequestSchema,
} from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission, viewerOf } from '../auth';
import { parseInput } from '../errors';
import * as banks from './service';
import { bankStore } from './store';
import { surveyResults } from './surveys';

const IdParams = z.object({ id: IdSchema });
const SurveyParams = z.object({ id: IdSchema, lessonId: IdSchema });

/**
 * Bank saves (up to 500 questions) and imports (about 2 MB of spreadsheet text, which grows when sent as JSON)
 * can be bigger than Fastify's 1 MB default.
 */
const LARGE_BODY = { bodyLimit: 4 * QUESTION_CSV_MAX_CHARACTERS };

// Question banks: Studio's bank API and spreadsheet import (learning.build), and survey results for
// reports (learning.analytics). Endpoints in docs/learning/api.md.
const banksRoutes: FastifyPluginAsync = async (app) => {
  const store = bankStore(app.db);
  const build = { preHandler: requirePermission('learning.build') };
  const analytics = { preHandler: requirePermission('learning.analytics') };
  const idOf = (request: FastifyRequest) => parseInput(IdParams, request.params).id;
  const workspaceOf = (request: FastifyRequest) => viewerOf(request).workspaceId;

  app.get('/studio/banks', build, async (request) => banks.listBanks(store, workspaceOf(request)));
  app.post('/studio/banks', build, async (request, reply) => {
    const input = parseInput(CreateBankRequestSchema, request.body);
    return reply.code(201).send(await banks.createBank(store, viewerOf(request), input));
  });
  app.get('/studio/banks/:id', build, async (request) =>
    banks.getBank(store, workspaceOf(request), idOf(request)),
  );
  app.put('/studio/banks/:id', { ...build, ...LARGE_BODY }, async (request) => {
    const input = parseInput(SaveBankRequestSchema, request.body);
    return banks.saveBank(store, workspaceOf(request), idOf(request), input);
  });
  app.delete('/studio/banks/:id', build, async (request, reply) => {
    await banks.deleteBank(store, workspaceOf(request), idOf(request));
    return reply.code(204).send();
  });
  app.post('/studio/banks/:id/import', { ...build, ...LARGE_BODY }, async (request) => {
    const { csv } = parseInput(ImportQuestionsRequestSchema, request.body);
    return banks.importQuestions(store, workspaceOf(request), idOf(request), csv);
  });
  app.get('/reports/courses/:id/surveys/:lessonId', analytics, async (request) => {
    const { id, lessonId } = parseInput(SurveyParams, request.params);
    return surveyResults(app.db, workspaceOf(request), id, lessonId);
  });
};

export default banksRoutes;
