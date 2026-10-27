import {
  CertificateListQuerySchema,
  TeamViewQuerySchema,
  TranscriptQuerySchema,
} from '@carehub/learning';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerPeriodicTask } from '../../jobs';
import { parseInput } from '../errors';
import { sendCsv } from '../reports/send';
import { CERTIFICATE_NOTICES_TASK, sendCertificateNotices } from './expiry';
import * as reports from './reports';
import * as certificates from './service';
import { viewerOf } from './viewer';

const HOUR_MS = 60 * 60 * 1000;
const CertificateParams = z.object({ id: z.string().max(64) });
const PersonParams = z.object({ personId: z.string().max(64) });

// Certificates: the learner's own, and anyone's for people with learning.analytics; and the
// person and team reports, which show them. Endpoints in docs/learning/api.md. The expiry notices
// run every hour; each goes out once.
const certificatesRoutes: FastifyPluginAsync = async (app) => {
  registerPeriodicTask(CERTIFICATE_NOTICES_TASK, HOUR_MS, async () => {
    await sendCertificateNotices(app.db);
  });

  app.get('/certificates', async (request) => {
    const viewer = viewerOf(request);
    const query = parseInput(CertificateListQuerySchema, request.query);
    return certificates.listCertificates(app.db, viewer, query);
  });
  app.get('/certificates/:id', async (request) => {
    const viewer = viewerOf(request);
    const { id } = parseInput(CertificateParams, request.params);
    return certificates.getCertificate(app.db, viewer, id);
  });

  app.get('/reports/people/:personId', async (request, reply) => {
    const viewer = viewerOf(request);
    const { personId } = parseInput(PersonParams, request.params);
    const query = parseInput(TranscriptQuerySchema, request.query);
    const sources = reports.postgresReportSources(app.db);
    if (query.format !== 'csv') return reports.personTranscript(sources, viewer, personId);
    return sendCsv(reply, await reports.personTranscriptCsv(sources, viewer, personId));
  });
  app.get('/reports/team', async (request, reply) => {
    const viewer = viewerOf(request);
    const { courseId, format } = parseInput(TeamViewQuerySchema, request.query);
    const sources = reports.postgresReportSources(app.db);
    if (format !== 'csv') return reports.teamReport(sources, viewer, courseId);
    return sendCsv(reply, await reports.teamReportCsv(sources, viewer, courseId));
  });
};

export default certificatesRoutes;
