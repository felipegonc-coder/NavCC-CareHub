import { IdSchema, ReportQuerySchema } from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { viewerOf } from '../auth';
import { parseInput } from '../errors';
import {
  courseReportCsvOf,
  courseReportOf,
  overdueCsvOf,
  overdueOf,
  postgresCourseReportSources,
  reportsOverviewCsvOf,
  reportsOverviewOf,
} from './course-reports';
import { sendCsv } from './send';

const CourseParams = z.object({ id: IdSchema });

// The reports overview, the course report and the overdue list (./course-reports), as JSON or,
// with ?format=csv, as a CSV download. The person, team and path reports have routers of their
// own. Endpoints in docs/learning/api.md; who is asking comes from ../auth.
const reportsRoutes: FastifyPluginAsync = async (app) => {
  const formatOf = (request: FastifyRequest) => parseInput(ReportQuerySchema, request.query).format;

  app.get('/reports/overview', async (request, reply) => {
    const viewer = viewerOf(request);
    const format = formatOf(request);
    const sources = postgresCourseReportSources(app.db);
    if (format !== 'csv') return reportsOverviewOf(sources, viewer);
    return sendCsv(reply, await reportsOverviewCsvOf(sources, viewer));
  });
  app.get('/reports/courses/:id', async (request, reply) => {
    const viewer = viewerOf(request);
    const { id } = parseInput(CourseParams, request.params);
    const format = formatOf(request);
    const sources = postgresCourseReportSources(app.db);
    if (format !== 'csv') return courseReportOf(sources, viewer, id);
    return sendCsv(reply, await courseReportCsvOf(sources, viewer, id));
  });
  app.get('/reports/overdue', async (request, reply) => {
    const viewer = viewerOf(request);
    const format = formatOf(request);
    const sources = postgresCourseReportSources(app.db);
    if (format !== 'csv') return overdueOf(sources, viewer);
    return sendCsv(reply, await overdueCsvOf(sources, viewer));
  });
};

export default reportsRoutes;
