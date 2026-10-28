import {
  LEARNING_PATH_FORMAT_VERSION,
  PathReportResponseSchema,
  type EnrollmentRow,
  type LearningPath,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import type { Viewer } from '../auth';
import { httpError } from '../errors';
import type { ReportGroup, RowsQuery } from '../reports/rows';
import { pathReportCsvOf, pathReportOf, type PathReportSources } from './report';

// The path report on plain data. Fictional people, groups, courses and paths only.
const WORKSPACE = '6e2d8b3f-9c4a-4d7e-8f1b-2c3d4e5f6a70';
const ADA = '6e2d8b3f-9c4a-4d7e-8f1b-2c3d4e5f6a01';
const BO = '6e2d8b3f-9c4a-4d7e-8f1b-2c3d4e5f6a02';
const CY = '6e2d8b3f-9c4a-4d7e-8f1b-2c3d4e5f6a03';
const DEE = '6e2d8b3f-9c4a-4d7e-8f1b-2c3d4e5f6a04';
const TARA = '6e2d8b3f-9c4a-4d7e-8f1b-2c3d4e5f6a05';
const MAX = '6e2d8b3f-9c4a-4d7e-8f1b-2c3d4e5f6a06';
// 12:00 in Denver, 03:00 the next day in Tokyo.
const NOW = new Date('2026-10-27T18:00:00.000Z');

const PATH: LearningPath = {
  formatVersion: LEARNING_PATH_FORMAT_VERSION,
  id: 'path-new-agents',
  title: 'New agent basics',
  courseIds: ['greeting-callers', 'billing-questions', 'closing-calls'],
  order: 'sequential',
};
// Billing questions has no live version yet.
const TITLES: Record<string, string> = {
  'greeting-callers': 'Greeting callers',
  'closing-calls': 'Closing calls',
  'privacy-basics': 'Privacy basics',
};

const row = (learnerId: string, name: string, more: Partial<EnrollmentRow>): EnrollmentRow => ({
  learnerId,
  learnerName: name,
  groupIds: [],
  courseId: 'greeting-callers',
  courseTitle: 'Greeting callers',
  status: 'not_started',
  score: null,
  activeSeconds: 0,
  attempts: 0,
  required: true,
  ...more,
});

const ROWS: EnrollmentRow[] = [
  row(ADA, 'Ada Example', {
    status: 'completed',
    startedAt: '2026-10-20T15:00:00.000Z',
    completedAt: '2026-10-21T16:00:00.000Z',
  }),
  row(ADA, 'Ada Example', {
    courseId: 'closing-calls',
    courseTitle: 'Closing calls',
    status: 'passed',
    completedAt: '2026-10-28T02:30:00.000Z',
  }),
  row(BO, 'Bo Sample', { status: 'in_progress', lastActivityAt: '2026-10-26T17:00:00.000Z' }),
  // Cy took Greeting callers without the path; Dee is on the path and hasn't started.
  row(CY, 'Cy Person', { status: 'completed', completedAt: '2026-10-02T16:00:00.000Z' }),
  row(CY, 'Cy Person', { courseId: 'privacy-basics', courseTitle: 'Privacy basics' }),
];

type World = { teams?: Record<string, string[]>; groups?: ReportGroup[] };

function sources(world: World = {}): PathReportSources & { asked: RowsQuery[] } {
  const asked: RowsQuery[] = [];
  const names: Record<string, string> = {
    [ADA]: 'Ada Example',
    [BO]: 'Bo Sample',
    [DEE]: 'Dee Doe',
  };
  const zones: Record<string, string> = { [TARA]: 'Asia/Tokyo', [MAX]: 'America/Denver' };
  return {
    asked,
    async path(_workspaceId, pathId) {
      if (pathId !== PATH.id) throw httpError(404);
      return PATH;
    },
    titles: async (_workspaceId, courseIds) =>
      new Map(courseIds.flatMap((id) => (TITLES[id] ? [[id, TITLES[id]] as const] : []))),
    async rows(query) {
      asked.push(query);
      return ROWS.filter(
        (each) =>
          (query.userIds === undefined || query.userIds.includes(each.learnerId)) &&
          (query.courseIds === undefined || query.courseIds.includes(each.courseId)),
      );
    },
    assignedTo: async () => [ADA, BO, DEE],
    names: async (userIds) =>
      new Map(userIds.flatMap((id) => (names[id] ? [[id, names[id]] as const] : []))),
    groups: async () => world.groups ?? [],
    reportsOf: async (_workspaceId, managerId) => world.teams?.[managerId] ?? [],
    timeZone: async (userId) => zones[userId] ?? null,
  };
}

const viewer = (userId: string, analyst = false): Viewer => ({
  userId,
  workspaceId: WORKSPACE,
  can: (permission) => analyst && permission === 'learning.analytics',
});

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: { status?: number }) => error.status,
  );

describe('pathReportOf', () => {
  it('shows analysts everyone on the path or in its live courses, in path order', async () => {
    const world = sources({ groups: [{ id: 'g-new', name: 'New agents', memberIds: [DEE] }] });
    const report = await pathReportOf(world, viewer(TARA, true), PATH.id, NOW);
    expect(report.path).toEqual({ id: PATH.id, title: 'New agent basics' });
    expect(report.courses).toEqual([
      { id: 'greeting-callers', title: 'Greeting callers' },
      { id: 'closing-calls', title: 'Closing calls' },
    ]);
    expect(world.asked).toEqual([
      {
        workspaceId: WORKSPACE,
        today: '2026-10-27',
        courseIds: ['greeting-callers', 'closing-calls'],
      },
    ]);
    expect(report.rows.map((each) => [each.learnerName, each.status, each.completed])).toEqual([
      ['Ada Example', 'completed', 2],
      ['Bo Sample', 'in_progress', 0],
      ['Cy Person', 'in_progress', 1],
      ['Dee Doe', 'not_started', 0],
    ]);
    expect(report.rows[3]).toMatchObject({ groupIds: ['g-new'], nextCourseId: 'greeting-callers' });
    expect(report).toMatchObject({
      learners: 4,
      notStarted: 1,
      inProgress: 2,
      completed: 1,
      completionPercent: 25,
    });
    const body = JSON.parse(JSON.stringify(report));
    expect(PathReportResponseSchema.parse(body)).toEqual(body);
  });

  it('shows a manager only their own people, and refuses everyone else', async () => {
    const world = sources({ teams: { [MAX]: [BO, DEE] } });
    const report = await pathReportOf(world, viewer(MAX), PATH.id, NOW);
    expect(report.rows.map((each) => each.learnerName)).toEqual(['Bo Sample', 'Dee Doe']);
    expect(world.asked[0]?.userIds).toEqual([BO, DEE]);
    expect(await status(pathReportOf(world, viewer(ADA), PATH.id, NOW))).toBe(403);
    expect(await status(pathReportOf(world, viewer(MAX), 'path-unknown', NOW))).toBe(404);
    expect(await status(pathReportOf(world, viewer(TARA, true), 'path-unknown', NOW))).toBe(404);
  });

  it('downloads as CSV with days in the viewer’s own time zone', async () => {
    const csv = await pathReportCsvOf(sources(), viewer(TARA, true), PATH.id, NOW);
    expect(csv.filename).toBe('path-report-2026-10-27.csv');
    expect(csv.text.startsWith('\uFEFFName,Status,')).toBe(true);
    // Ada finished at 02:30 UTC on the 28th: the 28th in Tokyo.
    expect(csv.text).toContain('Ada Example,Completed,2,2,100,,2026-10-28,2026-10-28');
    const denver = await pathReportCsvOf(sources(), viewer(MAX, true), PATH.id, NOW);
    expect(denver.text).toContain('Ada Example,Completed,2,2,100,,2026-10-27,2026-10-27');
  });
});
