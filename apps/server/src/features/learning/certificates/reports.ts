import {
  LIMITS,
  isoDateInTimeZone,
  teamMembers,
  teamView,
  teamViewCsv,
  transcriptCsv,
  transcriptRows,
  type CertificateRecord,
  type EnrollmentRow,
  type IsoDate,
  type TeamViewResponse,
  type TranscriptRow,
} from '@carehub/learning';
import { DEFAULT_TIME_ZONE } from '@carehub/shared';
import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { users } from '../../auth/schema';
import { httpError } from '../errors';
import {
  enrollmentRows,
  reportGroups,
  reportsOf,
  type ReportGroup,
  type RowsQuery,
} from '../reports/rows';
import type { CsvFile } from '../reports/send';
import { learningCertificates as certificates } from './schema';
import { isUuid, recordOf } from './service';
import type { Viewer } from './viewer';

// The person and team reports (docs/learning/api.md): GET /reports/people/:personId, a person's
// learning record, and GET /reports/team, how each group is getting on. People read their own
// record; people with learning.analytics read everyone's and every group; managers read their own
// team's. What these read comes in through ReportSources, so this file also runs on plain data in
// tests. Overdue and certificate expiry go by today in the Learning day zone; CSV dates are days
// in the viewer's profile zone (decision 0317).

/** What the person and team reports read. */
export type ReportSources = {
  rows(query: RowsQuery): Promise<EnrollmentRow[]>;
  /** The workspace's groups, with their members now. */
  groups(workspaceId: string): Promise<ReportGroup[]>;
  /** The people who report to `managerId`. */
  reportsOf(workspaceId: string, managerId: string): Promise<string[]>;
  /** A person's name and profile time zone, or null when there is no such person. */
  person(userId: string): Promise<{ name: string; timeZone: string | null } | null>;
  /** Every certificate the learner holds in the workspace. */
  certificates(workspaceId: string, learnerId: string): Promise<CertificateRecord[]>;
};

/** A person's learning record (`PersonTranscriptResponse`). */
export type PersonTranscript = { person: { id: string; name: string }; rows: TranscriptRow[] };

/** The id of a manager's team in the team view, which isn't a workspace group. */
export const teamGroupId = (managerId: string): string => `team-${managerId}`;

/** Today in the Learning day zone (decision 0317). */
export const learningToday = (now: Date): IsoDate =>
  isoDateInTimeZone(now.toISOString(), DEFAULT_TIME_ZONE);

/** `timeZone` when it is a known IANA zone, otherwise Care Hub's default zone. */
export function profileZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byText = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * GET /reports/people/:personId: the person's courses, newest first, each with its current
 * certificate. The viewer's own, anyone's with learning.analytics, or a manager's report's; 403
 * for anyone else. 404 when the id names nobody. Until core can say who is in the workspace,
 * analysts get 404 for someone with no courses here either, so names from other workspaces stay
 * out.
 */
export async function personTranscript(
  sources: ReportSources,
  viewer: Viewer,
  personId: string,
  now = new Date(),
): Promise<PersonTranscript> {
  if (!isUuid(personId)) throw httpError(404);
  const { workspaceId } = viewer;
  const own = personId === viewer.userId;
  const analyst = viewer.can('learning.analytics');
  const managed =
    !own && !analyst && (await sources.reportsOf(workspaceId, viewer.userId)).includes(personId);
  if (!own && !analyst && !managed) throw httpError(403);
  const person = await sources.person(personId);
  if (!person) throw httpError(404);
  const today = learningToday(now);
  const rows = await sources.rows({ workspaceId, today, userIds: [personId] });
  if (!own && !managed && rows.length === 0) throw httpError(404);
  const held = await sources.certificates(workspaceId, personId);
  return {
    person: { id: personId, name: person.name.slice(0, LIMITS.title) },
    rows: transcriptRows(rows, held, today),
  };
}

/** GET /reports/people/:personId?format=csv: the record as CSV (`transcriptCsv`). */
export async function personTranscriptCsv(
  sources: ReportSources,
  viewer: Viewer,
  personId: string,
  now = new Date(),
): Promise<CsvFile> {
  const transcript = await personTranscript(sources, viewer, personId, now);
  const timeZone = profileZone((await sources.person(viewer.userId))?.timeZone);
  const today = learningToday(now);
  return {
    filename: `learning-record-${today}.csv`,
    text: transcriptCsv(transcript.rows, today, { timeZone, bom: true }),
  };
}

/**
 * The groups the viewer may see in the team view, by name: every workspace group with
 * learning.analytics, and a manager's own team ("Your team"). 403 for someone with neither.
 */
async function visibleGroups(sources: ReportSources, viewer: Viewer): Promise<ReportGroup[]> {
  const { workspaceId, userId } = viewer;
  const analyst = viewer.can('learning.analytics');
  const groups = analyst ? await sources.groups(workspaceId) : [];
  const team = await sources.reportsOf(workspaceId, userId);
  if (!analyst && team.length === 0) throw httpError(403);
  const yours =
    team.length === 0 ? [] : [{ id: teamGroupId(userId), name: 'Your team', memberIds: team }];
  const named = groups.map((group) => ({ ...group, name: group.name.slice(0, LIMITS.title) }));
  return [...yours, ...named.sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))];
}

/**
 * GET /reports/team: every course the viewer's people are enrolled in, by title; one entry per
 * group the viewer may see (`teamView`); and one line per person in those groups (`teamMembers`).
 * Groups and people cover `courseId` only, when given.
 */
export async function teamReport(
  sources: ReportSources,
  viewer: Viewer,
  courseId?: string,
  now = new Date(),
): Promise<TeamViewResponse> {
  const groups = await visibleGroups(sources, viewer);
  const people = [...new Set(groups.flatMap((group) => group.memberIds))];
  const today = learningToday(now);
  const rows =
    people.length === 0
      ? []
      : await sources.rows({ workspaceId: viewer.workspaceId, today, userIds: people });
  // Each row's groups are the ones shown here, so a manager's team counts as one.
  const inGroups = rows.map((row) => ({
    ...row,
    groupIds: groups.filter((g) => g.memberIds.includes(row.learnerId)).map((g) => g.id),
  }));
  const titles = new Map(inGroups.map((row) => [row.courseId, row.courseTitle]));
  const courses = [...titles]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => byText(a.title, b.title) || byText(a.id, b.id));
  const shown = courseId === undefined ? inGroups : inGroups.filter((r) => r.courseId === courseId);
  return {
    courses,
    groups: teamView(shown, groups, today),
    people: teamMembers(shown, today),
  };
}

/** GET /reports/team?format=csv: one line per group (`teamViewCsv`). */
export async function teamReportCsv(
  sources: ReportSources,
  viewer: Viewer,
  courseId?: string,
  now = new Date(),
): Promise<CsvFile> {
  const report = await teamReport(sources, viewer, courseId, now);
  return {
    filename: `team-learning-${learningToday(now)}.csv`,
    text: teamViewCsv(report.groups, { bom: true }),
  };
}

/** The report sources on the server's database. */
export function postgresReportSources(db: Db | Tx): ReportSources {
  return {
    rows: (query) => enrollmentRows(db, query),
    groups: (workspaceId) => reportGroups(db, workspaceId),
    reportsOf: (workspaceId, managerId) => reportsOf(db, workspaceId, managerId),
    async person(userId) {
      const [user] = await db
        .select({ name: users.name, timeZone: users.timeZone })
        .from(users)
        .where(eq(users.id, userId));
      return user ?? null;
    },
    async certificates(workspaceId, learnerId) {
      const rows = await db
        .select()
        .from(certificates)
        .where(
          and(eq(certificates.workspaceId, workspaceId), eq(certificates.learnerId, learnerId)),
        );
      return rows.map(recordOf);
    },
  };
}
