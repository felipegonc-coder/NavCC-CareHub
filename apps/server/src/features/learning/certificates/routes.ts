import { CertificateListQuerySchema } from '@carehub/learning';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerPeriodicTask } from '../../jobs';
import { parseInput } from '../errors';
import { CERTIFICATE_NOTICES_TASK, runCertificateJobs } from './expiry';
import * as certificates from './service';
import { viewerOf } from './viewer';

const HOUR_MS = 60 * 60 * 1000;
const CertificateParams = z.object({ id: z.string().max(64) });

// Certificates (B3): the learner's own, and anyone's for people with learning.analytics. Endpoints
// in docs/learning/api.md. The certificate jobs (re-certification and the expiry notices) run every
// hour; each happens once per certificate.
const certificatesRoutes: FastifyPluginAsync = async (app) => {
  registerPeriodicTask(CERTIFICATE_NOTICES_TASK, HOUR_MS, async () => {
    await runCertificateJobs(app.db);
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
};

export default certificatesRoutes;
