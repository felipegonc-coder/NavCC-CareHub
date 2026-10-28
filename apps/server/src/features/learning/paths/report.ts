import {
  learningToday,
  LIMITS,
  pathReport,
  pathReportCsv,
  profileZone,
  type EnrollmentRow,
  type IsoDate,
  type LearningPath,
  type PathReportResponse,
} from '@carehub/learning';
import type { Db, Tx } from '../../../db';
import { learnerAssignments } from '../assignments/service';
import { postgresSources } from '../assignments/sources';
import type { Viewer } from '../auth';
import { postgresReportSources } from '../certificates/reports';
import { httpError } from '../errors';
import {
  enrollmentRows,
  namesOf,
  reportGroups,
  reportsOf,
  type ReportGroup,
  type RowsQuery,
} from '../reports/rows';
import type { CsvFile } from '../reports/send';
import { getPath } from './service';

// The path report (docs/learning/api.md): GET /reports/paths/:id, how far each person on a path
// has got through its courses. People on the path are the ones it is assigned to now, directly or
// through a group, and anyone enrolled in one of its courses. People with learning.analytics see
// everyone on it, managers their own people; everyone else gets 403. What the report reads comes
// in through PathReportSources, so it also runs on plain data in tests. Days as in the person and
// team reports (decision 0317).

/** What the path report reads. */
export type PathReportSources = {
  /** The path; 404 when the workspace has none with this id. */
  path(workspaceId: string, pathId: string): Promise<LearningPath>;
  /** The live titles of these courses, by id. Courses without a live version are left out. */
  titles(workspaceId: string, courseIds: readonly string[]): Promise<Map<string, string>>;
  rows(query: RowsQuery): Promise<EnrollmentRow[]>;
  /** The people the path is assigned to on `today`, directly or through a group. */
  assignedTo(workspaceId: string, pathId: string, today: IsoDate): Promise<string[]>;
  /** People's names by id. */
  names(userIds: readonly string[]): Promise<Map<string, string>>;
  /** The workspace's groups, with their members now. */
  groups(workspaceId: string): Promise<ReportGroup[]>;
  /** The people who report to `managerId`. */
  reportsOf(workspaceId: string, managerId: string): Promise<string[]>;
  /** A person's profile time zone, or null without one. */
  timeZone(userId: string): Promise<string | null>;
};

/**
 * GET /reports/paths/:id: the path, its live courses in path order, the headline numbers and one
 * row per person on the path, by name (`pathReport`). Everyone on the path with
 * learning.analytics, or only a manager's own people; 403 for anyone else, 404 for an unknown
 * path.
 */
export async function pathReportOf(
  sources: PathReportSources,
  viewer: Viewer,
  pathId: string,
  now = new Date(),
): Promise<PathReportResponse> {
  const { workspaceId, userId } = viewer;
  const team = viewer.can('learning.analytics')
    ? null
    : await sources.reportsOf(workspaceId, userId);
  if (team?.length === 0) throw httpError(403);
  const path = await sources.path(workspaceId, pathId);
  const today = learningToday(now);
  const titles = await sources.titles(workspaceId, path.courseIds);
  const courses = [...new Set(path.courseIds)].flatMap((id) => {
    const title = titles.get(id);
    return title === undefined ? [] : [{ id, title: title.slice(0, LIMITS.title) }];
  });
  const shown = (learnerId: string) => team === null || team.includes(learnerId);
  const rows =
    courses.length === 0
      ? []
      : await sources.rows({
          workspaceId,
          today,
          courseIds: courses.map((course) => course.id),
          ...(team !== null && { userIds: team }),
        });
  const assigned = (await sources.assignedTo(workspaceId, path.id, today)).filter(shown);
  const [names, groups] = await Promise.all([sources.names(assigned), sources.groups(workspaceId)]);
  const learners = assigned.map((id) => ({
    id,
    name: (names.get(id) ?? '').slice(0, LIMITS.title),
    groupIds: groups.filter((group) => group.memberIds.includes(id)).map((group) => group.id),
  }));
  return {
    path: { id: path.id, title: path.title },
    courses,
    ...pathReport(
      path,
      courses,
      rows.filter((row) => shown(row.learnerId)),
      learners,
    ),
  };
}

/**
 * GET /reports/paths/:id?format=csv: the rows as CSV (`pathReportCsv`), with days in the viewer's
 * profile zone.
 */
export async function pathReportCsvOf(
  sources: PathReportSources,
  viewer: Viewer,
  pathId: string,
  now = new Date(),
): Promise<CsvFile> {
  const report = await pathReportOf(sources, viewer, pathId, now);
  const timeZone = profileZone(await sources.timeZone(viewer.userId));
  return {
    filename: `path-report-${learningToday(now)}.csv`,
    text: pathReportCsv(report, { timeZone, bom: true }),
  };
}

/** The path report's sources on the server's database. */
export function postgresPathReportSources(db: Db | Tx): PathReportSources {
  const assignments = postgresSources(db);
  return {
    path: (workspaceId, pathId) => getPath(db, workspaceId, pathId),
    async titles(workspaceId, courseIds) {
      const live = await assignments.liveCourses(workspaceId, courseIds);
      return new Map([...live].map(([id, course]) => [id, course.title]));
    },
    rows: (query) => enrollmentRows(db, query),
    async assignedTo(workspaceId, pathId, today) {
      const made = await assignments.store.list(workspaceId, { pathId });
      if (made.length === 0) return [];
      const ids = new Set(made.map((assignment) => assignment.id));
      const reached = await learnerAssignments(assignments, workspaceId, today);
      const onPath = reached.assignments.filter((learner) =>
        learner.assignmentIds.some((id) => ids.has(id)),
      );
      return [...new Set(onPath.map((learner) => learner.learnerId))];
    },
    names: (userIds) => namesOf(db, userIds),
    groups: (workspaceId) => reportGroups(db, workspaceId),
    reportsOf: (workspaceId, managerId) => reportsOf(db, workspaceId, managerId),
    timeZone: async (userId) => (await postgresReportSources(db).person(userId))?.timeZone ?? null,
  };
}
