import {
  CERTIFICATE_CODE_RANDOM_BYTES,
  PersonTranscriptResponseSchema,
  TeamViewResponseSchema,
  createCertificateCode,
  type CertificateRecord,
  type EnrollmentRow,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import type { ReportGroup, RowsQuery } from '../reports/rows';
import {
  learningToday,
  personTranscript,
  personTranscriptCsv,
  profileZone,
  teamGroupId,
  teamReport,
  teamReportCsv,
  type ReportSources,
} from './reports';
import type { Viewer } from './viewer';

// The person and team reports on plain data. Fictional people, groups and courses only.
const WORKSPACE = '5d1c7a2e-8b3f-4c6d-9e0a-1b2c3d4e5f60';
const ADA = '5d1c7a2e-8b3f-4c6d-9e0a-1b2c3d4e5f01';
const BO = '5d1c7a2e-8b3f-4c6d-9e0a-1b2c3d4e5f02';
const CY = '5d1c7a2e-8b3f-4c6d-9e0a-1b2c3d4e5f03';
const TARA = '5d1c7a2e-8b3f-4c6d-9e0a-1b2c3d4e5f04';
const MAX = '5d1c7a2e-8b3f-4c6d-9e0a-1b2c3d4e5f05';
// 12:00 in Denver, 03:00 the next day in Tokyo.
const NOW = new Date('2026-10-27T18:00:00.000Z');

const row = (learnerId: string, more: Partial<EnrollmentRow> = {}): EnrollmentRow => ({
  learnerId,
  learnerName: `Learner ${learnerId.slice(-2)}`,
  groupIds: [],
  courseId: 'calls-with-care',
  courseTitle: 'Handling calls with care',
  status: 'in_progress',
  score: null,
  activeSeconds: 300,
  attempts: 0,
  required: true,
  ...more,
});

const ROWS: EnrollmentRow[] = [
  row(ADA, {
    learnerName: 'Ada Example',
    status: 'passed',
    score: 92,
    attempts: 1,
    startedAt: '2026-10-01T15:00:00.000Z',
    completedAt: '2026-10-26T20:30:00.000Z',
  }),
  row(ADA, {
    learnerName: 'Ada Example',
    courseId: 'privacy-basics',
    courseTitle: 'Privacy basics',
    status: 'not_started',
    dueDate: '2026-10-20',
  }),
  row(BO, { learnerName: 'Bo Sample', startedAt: '2026-10-25T15:00:00.000Z' }),
  row(CY, { learnerName: 'Cy Person', courseId: 'privacy-basics', courseTitle: 'Privacy basics' }),
];

const certificate: CertificateRecord = {
  id: '5d1c7a2e-8b3f-4c6d-9e0a-1b2c3d4e5fc1',
  code: createCertificateCode(new Uint8Array(CERTIFICATE_CODE_RANDOM_BYTES)),
  learnerId: ADA,
  learnerName: 'Ada Example',
  courseId: 'calls-with-care',
  courseTitle: 'Handling calls with care',
  courseVersion: 1,
  completedAt: '2026-10-26T20:30:00.000Z',
  issuedOn: '2026-10-26',
  expiresOn: '2026-11-10',
  score: 92,
};

type World = {
  rows?: EnrollmentRow[];
  groups?: ReportGroup[];
  /** Each manager's reports. */
  teams?: Record<string, string[]>;
};

const PEOPLE: Record<string, { name: string; timeZone: string | null }> = {
  [ADA]: { name: 'Ada Example', timeZone: 'America/Denver' },
  [BO]: { name: 'Bo Sample', timeZone: null },
  [CY]: { name: 'Cy Person', timeZone: 'Asia/Tokyo' },
  [TARA]: { name: 'Tara Trainer', timeZone: 'Asia/Tokyo' },
  [MAX]: { name: 'Max Manager', timeZone: 'Not/A_Zone' },
};

function sources(world: World = {}): ReportSources & { asked: RowsQuery[] } {
  const asked: RowsQuery[] = [];
  return {
    asked,
    async rows(query) {
      asked.push(query);
      return (world.rows ?? ROWS).filter(
        (each) =>
          (query.userIds === undefined || query.userIds.includes(each.learnerId)) &&
          (query.courseIds === undefined || query.courseIds.includes(each.courseId)),
      );
    },
    groups: async () => world.groups ?? [],
    reportsOf: async (_workspaceId, managerId) => world.teams?.[managerId] ?? [],
    person: async (userId) => PEOPLE[userId] ?? null,
    certificates: async (_workspaceId, learnerId) =>
      [certificate].filter((each) => each.learnerId === learnerId),
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

describe('personTranscript', () => {
  it("gives a person their own record, newest first, with each course's certificate", async () => {
    const world = sources();
    const transcript = await personTranscript(world, viewer(ADA), ADA, NOW);
    expect(transcript.person).toEqual({ id: ADA, name: 'Ada Example' });
    expect(
      transcript.rows.map((each) => [each.courseId, each.certificate?.status ?? null]),
    ).toEqual([
      ['calls-with-care', 'expiring_soon'],
      ['privacy-basics', null],
    ]);
    expect(world.asked).toEqual([{ workspaceId: WORKSPACE, today: '2026-10-27', userIds: [ADA] }]);
    const body = JSON.parse(JSON.stringify(transcript));
    expect(PersonTranscriptResponseSchema.parse(body)).toEqual(body);
  });

  it('shows analysts anyone with courses here, and a manager their team', async () => {
    expect((await personTranscript(sources(), viewer(TARA, true), BO, NOW)).person.name).toBe(
      'Bo Sample',
    );
    const managed = sources({ rows: [], teams: { [MAX]: [BO] } });
    expect(await personTranscript(managed, viewer(MAX), BO, NOW)).toEqual({
      person: { id: BO, name: 'Bo Sample' },
      rows: [],
    });
  });

  it('refuses everyone else, and finds nobody behind a wrong id', async () => {
    const world = sources({ teams: { [MAX]: [BO] } });
    expect(
      await Promise.all([
        status(personTranscript(world, viewer(BO), ADA, NOW)),
        status(personTranscript(world, viewer(MAX), ADA, NOW)),
        status(personTranscript(world, viewer(TARA, true), 'not-a-person', NOW)),
        status(personTranscript(world, viewer(BO), 'not-a-person', NOW)),
        status(personTranscript(world, viewer(TARA, true), MAX, NOW)),
        status(
          personTranscript(world, viewer(TARA, true), '5d1c7a2e-8b3f-4c6d-9e0a-000000000000', NOW),
        ),
      ]),
    ).toEqual([403, 403, 404, 404, 404, 404]);
    expect(world.asked.map((query) => query.userIds)).toEqual([[MAX]]);
  });

  it('downloads as CSV with days in the viewer’s own time zone', async () => {
    const file = await personTranscriptCsv(sources(), viewer(TARA, true), ADA, NOW);
    expect(file.filename).toBe('learning-record-2026-10-27.csv');
    const [header, first, second] = file.text.split('\r\n');
    const { code } = certificate;
    expect(header).toBe(
      '\uFEFFCourse,Status,Score,Time spent (minutes),Attempts,Started,Completed,Due,' +
        'Days overdue,Certificate,Certificate expires',
    );
    // Finished at 20:30 UTC on the 26th: already the 27th in Tokyo.
    expect(first).toBe(
      `Handling calls with care,Passed,92,5,1,2026-10-02,2026-10-27,,,${code},2026-11-10`,
    );
    expect(second).toBe('Privacy basics,Not started,,5,0,,,2026-10-20,7,,');
    const own = await personTranscriptCsv(sources(), viewer(ADA), ADA, NOW);
    expect(own.text.split('\r\n')[1]).toContain(',2026-10-01,2026-10-26,');
  });
});

describe('teamReport', () => {
  const groups: ReportGroup[] = [
    { id: 'g-voice', name: 'Voice', memberIds: [ADA, BO] },
    { id: 'g-chat', name: 'chat', memberIds: [BO, CY] },
    { id: 'g-empty', name: 'Weekend', memberIds: [] },
  ];

  it('gives analysts every group by name, its people and their courses', async () => {
    const world = sources({ groups });
    const report = await teamReport(world, viewer(TARA, true), undefined, NOW);
    expect(report.courses).toEqual([
      { id: 'calls-with-care', title: 'Handling calls with care' },
      { id: 'privacy-basics', title: 'Privacy basics' },
    ]);
    expect(report.groups.map((g) => [g.groupName, g.learners, g.total, g.overdue])).toEqual([
      ['chat', 2, 2, 0],
      ['Voice', 2, 3, 1],
      ['Weekend', 0, 0, 0],
    ]);
    expect(
      report.people.map((p) => [p.name, p.groupIds, p.courses, p.finished, p.overdue]),
    ).toEqual([
      ['Ada Example', ['g-voice'], 2, 1, 1],
      ['Bo Sample', ['g-chat', 'g-voice'], 1, 0, 0],
      ['Cy Person', ['g-chat'], 1, 0, 0],
    ]);
    expect(world.asked).toEqual([
      { workspaceId: WORKSPACE, today: '2026-10-27', userIds: [BO, CY, ADA] },
    ]);
    const body = JSON.parse(JSON.stringify(report));
    expect(TeamViewResponseSchema.parse(body)).toEqual(body);
  });

  it('narrows groups and people to one course, keeping every course to pick from', async () => {
    const report = await teamReport(sources({ groups }), viewer(TARA, true), 'privacy-basics', NOW);
    expect(report.courses).toHaveLength(2);
    expect(report.groups.map((g) => [g.groupId, g.total])).toEqual([
      ['g-chat', 1],
      ['g-voice', 1],
      ['g-empty', 0],
    ]);
    expect(report.people.map((p) => p.name)).toEqual(['Ada Example', 'Cy Person']);
  });

  it("gives a manager only their own team, and refuses people who aren't one", async () => {
    const world = sources({ groups, teams: { [MAX]: [CY] } });
    const report = await teamReport(world, viewer(MAX), undefined, NOW);
    expect(report.groups.map((g) => [g.groupId, g.groupName, g.learners])).toEqual([
      [teamGroupId(MAX), 'Your team', 1],
    ]);
    expect(report.people.map((p) => [p.name, p.groupIds])).toEqual([
      ['Cy Person', [teamGroupId(MAX)]],
    ]);
    expect(await status(teamReport(world, viewer(BO), undefined, NOW))).toBe(403);
    expect(await teamReport(sources(), viewer(TARA, true), undefined, NOW)).toEqual({
      courses: [],
      groups: [],
      people: [],
    });
  });

  it('downloads as CSV, one line per group', async () => {
    const file = await teamReportCsv(sources({ groups }), viewer(TARA, true), undefined, NOW);
    expect(file.filename).toBe('team-learning-2026-10-27.csv');
    const lines = file.text.split('\r\n');
    expect(lines[0]?.startsWith('\uFEFFGroup,Learners,Enrollments,')).toBe(true);
    expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual([
      'chat',
      'Voice',
      'Weekend',
      '',
    ]);
  });
});

describe('days and zones', () => {
  it('reads today in Denver, and falls back to Denver for unknown profile zones', () => {
    expect(learningToday(new Date('2026-10-28T05:59:00.000Z'))).toBe('2026-10-27');
    expect(learningToday(new Date('2026-10-28T06:00:00.000Z'))).toBe('2026-10-28');
    expect([profileZone('Asia/Tokyo'), profileZone('Not/A_Zone'), profileZone(null)]).toEqual([
      'Asia/Tokyo',
      'America/Denver',
      'America/Denver',
    ]);
  });
});
