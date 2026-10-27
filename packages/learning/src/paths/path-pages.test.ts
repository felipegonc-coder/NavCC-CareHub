import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { LearningPath } from '../format/index';
import {
  CreatePathRequestSchema,
  PathListResponseSchema,
  PathPageResponseSchema,
  PathReportQuerySchema,
  PathReportResponseSchema,
  PathReportRowSchema,
  SavePathRequestSchema,
  pathPage,
  pathProblems,
  pathReport,
  pathReportCsv,
  type PathEnrollment,
  type PathReportResponse,
  type PathReportRow,
} from './index';

/** True only when each type is assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Fictional path, courses and people only.
const path: LearningPath = {
  formatVersion: 1,
  id: 'new-agent-path',
  title: 'New agent path',
  description: 'Everything for your first two weeks.',
  courseIds: ['welcome', 'tools', 'calls', 'wrap-up'],
  order: 'sequential',
};
const titles = [
  { id: 'welcome', title: 'Welcome to Care' },
  { id: 'tools', title: 'Our tools' },
  { id: 'calls', title: 'Taking calls' },
  { id: 'wrap-up', title: 'Call wrap-up' },
];

describe('pathPage', () => {
  it('lists the courses the learner can open, with status, locks and progress', () => {
    const courses = [
      { id: 'welcome', title: 'Welcome to Care', summary: 'Start here.', estimatedMinutes: 10 },
      { id: 'tools', title: 'Our tools' },
      { id: 'wrap-up', title: 'Call wrap-up', summary: undefined },
    ];
    const page = pathPage(path, courses, { welcome: 'passed', calls: 'completed' });
    expect(page).toEqual({
      path: { ...path, courseIds: ['welcome', 'tools', 'wrap-up'] },
      courses: [
        {
          id: 'welcome',
          title: 'Welcome to Care',
          summary: 'Start here.',
          estimatedMinutes: 10,
          status: 'passed',
          locked: false,
        },
        { id: 'tools', title: 'Our tools', status: 'not_started', locked: false },
        { id: 'wrap-up', title: 'Call wrap-up', status: 'not_started', locked: true },
      ],
      progress: {
        completed: 1,
        total: 3,
        percent: 33,
        nextCourseId: 'tools',
        status: 'in_progress',
        lockedCourseIds: ['wrap-up'],
      },
    });
    expect(PathPageResponseSchema.parse(page)).toEqual(page);
    // "calls" can't be opened, so the page never names it.
    expect(JSON.stringify(page)).not.toContain('calls');
  });

  it('locks nothing on a free path and handles a path with no courses to show', () => {
    const free = pathPage({ ...path, order: 'free' }, titles, {});
    expect(free.courses.every((course) => !course.locked)).toBe(true);
    const empty = pathPage(path, [], { welcome: 'passed' });
    expect(empty.courses).toEqual([]);
    expect(empty.progress).toMatchObject({ total: 0, percent: 0, status: 'not_started' });
  });
});

describe('path API schemas', () => {
  it('fills in a new path and checks titles and courses', () => {
    expect(CreatePathRequestSchema.parse({ title: 'Billing basics' })).toEqual({
      title: 'Billing basics',
      courseIds: [],
      order: 'sequential',
    });
    expect(CreatePathRequestSchema.safeParse({ title: '' }).success).toBe(false);
    expect(
      CreatePathRequestSchema.safeParse({ title: 'Twice', courseIds: ['a', 'a'] }).success,
    ).toBe(false);
    expect(CreatePathRequestSchema.safeParse({ title: 'x', id: 'mine' }).success).toBe(false);
  });

  it('saves the whole path and lists summaries', () => {
    expect(SavePathRequestSchema.parse(path)).toEqual(path);
    expect(SavePathRequestSchema.safeParse({ ...path, formatVersion: 2 }).success).toBe(false);
    const summary = {
      id: path.id,
      title: path.title,
      courseCount: 4,
      order: path.order,
      updatedAt: '2026-10-27T15:00:00.000Z',
    };
    expect(PathListResponseSchema.parse([summary])).toEqual([summary]);
    expect(PathListResponseSchema.safeParse([{ ...summary, courseCount: 31 }]).success).toBe(false);
  });
});

describe('pathProblems', () => {
  it('is empty for a path of 2 or more live courses', () => {
    const live = titles.map((course) => ({ ...course, live: true, archived: false }));
    expect(pathProblems(path, live)).toEqual([]);
  });

  it('asks for 2 courses and names deleted, archived and unpublished ones', () => {
    expect(pathProblems({ courseIds: ['welcome'] }, [])).toEqual([
      { path: 'courseIds', message: 'Add at least 2 courses to the path.' },
      {
        path: 'courseIds[0]',
        courseId: 'welcome',
        message: 'Course 1 was deleted. Remove it from the path.',
      },
    ]);
    const courses = [
      { id: 'welcome', title: 'Welcome to Care', live: true, archived: false },
      { id: 'tools', title: 'Our tools', live: true, archived: true },
      { id: 'calls', title: 'Taking calls', live: false, archived: false },
    ];
    expect(pathProblems(path, courses).map((problem) => problem.message)).toEqual([
      '“Our tools” is archived. Unarchive it or remove it from the path.',
      "“Taking calls” isn't published yet. Publish it or remove it from the path.",
      'Course 4 was deleted. Remove it from the path.',
    ]);
  });
});

describe('pathReport', () => {
  const row = (
    overrides: Partial<PathEnrollment> & Pick<PathEnrollment, 'learnerId' | 'courseId'>,
  ) => ({
    learnerName: overrides.learnerId === 'u-bo' ? 'Bo Sample' : 'Ada Example',
    groupIds: ['g-voice'],
    status: 'in_progress' as const,
    ...overrides,
  });
  const rows: PathEnrollment[] = [
    row({
      learnerId: 'u-ada',
      courseId: 'welcome',
      status: 'passed',
      startedAt: '2026-10-20T09:00:00.000Z',
      completedAt: '2026-10-20T10:00:00.000Z',
    }),
    row({
      learnerId: 'u-ada',
      courseId: 'tools',
      status: 'completed',
      completedAt: '2026-10-21T10:00:00.000Z',
    }),
    row({
      learnerId: 'u-ada',
      courseId: 'calls',
      status: 'passed',
      completedAt: '2026-10-25T03:30:00.000Z',
    }),
    row({
      learnerId: 'u-ada',
      courseId: 'wrap-up',
      status: 'completed',
      completedAt: '2026-10-22T10:00:00.000Z',
    }),
    row({
      learnerId: 'u-bo',
      courseId: 'welcome',
      status: 'failed',
      lastActivityAt: '2026-10-25T08:00:00.000Z',
    }),
    row({
      learnerId: 'u-bo',
      courseId: 'other-course',
      status: 'passed',
      lastActivityAt: '2026-10-26T08:00:00.000Z',
    }),
  ];

  it('gives one row per learner, by name, with people who have not started', () => {
    const report = pathReport(path, titles, rows, [
      { id: 'u-cy', name: 'Cy Placeholder', groupIds: ['g-chat'] },
      { id: 'u-ada', name: 'Ada Example' },
    ]);
    expect(report).toEqual({
      learners: 3,
      notStarted: 1,
      inProgress: 1,
      completed: 1,
      completionPercent: 33,
      rows: [
        {
          learnerId: 'u-ada',
          learnerName: 'Ada Example',
          groupIds: ['g-voice'],
          status: 'completed',
          completed: 4,
          total: 4,
          percent: 100,
          nextCourseId: null,
          nextCourseTitle: null,
          lastActivityAt: '2026-10-25T03:30:00.000Z',
          completedAt: '2026-10-25T03:30:00.000Z',
        },
        {
          learnerId: 'u-bo',
          learnerName: 'Bo Sample',
          groupIds: ['g-voice'],
          status: 'in_progress',
          completed: 0,
          total: 4,
          percent: 0,
          nextCourseId: 'welcome',
          nextCourseTitle: 'Welcome to Care',
          lastActivityAt: '2026-10-25T08:00:00.000Z',
          completedAt: null,
        },
        {
          learnerId: 'u-cy',
          learnerName: 'Cy Placeholder',
          groupIds: ['g-chat'],
          status: 'not_started',
          completed: 0,
          total: 4,
          percent: 0,
          nextCourseId: 'welcome',
          nextCourseTitle: 'Welcome to Care',
          lastActivityAt: null,
          completedAt: null,
        },
      ],
    });
  });

  it('counts the further of two rows for the same course and only the courses given', () => {
    const twice = [
      row({
        learnerId: 'u-bo',
        courseId: 'welcome',
        status: 'completed',
        completedAt: '2026-10-26T08:00:00.000Z',
      }),
      row({ learnerId: 'u-bo', courseId: 'welcome', status: 'in_progress' }),
    ];
    const [bo] = pathReport(path, titles.slice(0, 2), twice).rows;
    expect(bo).toMatchObject({ completed: 1, total: 2, percent: 50, nextCourseTitle: 'Our tools' });
    expect(pathReport(path, titles, [])).toEqual({
      learners: 0,
      notStarted: 0,
      inProgress: 0,
      completed: 0,
      completionPercent: 0,
      rows: [],
    });
  });

  it('writes CSV with calendar days in the workspace time zone', () => {
    const report = pathReport(path, titles, rows);
    expect(pathReportCsv(report, { timeZone: 'America/Denver' })).toBe(
      'Name,Status,Courses finished,Courses,Percent,Next course,Last activity,Completed\r\n' +
        'Ada Example,Completed,4,4,100,,2026-10-24,2026-10-24\r\n' +
        'Bo Sample,In progress,0,4,0,Welcome to Care,2026-10-25,\r\n',
    );
    expect(pathReportCsv(report, { bom: true }).startsWith('\uFEFFName,')).toBe(true);
    expect(pathReportCsv(report)).toContain('Ada Example,Completed,4,4,100,,2026-10-25,2026-10-25');
  });

  it('goes over the wire as the path report response', () => {
    const same: Same<z.infer<typeof PathReportRowSchema>, PathReportRow> = true;
    expect(same).toBe(true);
    const response: PathReportResponse = {
      path: { id: path.id, title: path.title },
      courses: titles,
      ...pathReport(path, titles, rows, [{ id: 'u-cy', name: 'Cy Person' }]),
    };
    const body = JSON.parse(JSON.stringify(response));
    expect(PathReportResponseSchema.parse(body)).toEqual(body);
    expect(body.rows).toHaveLength(3);
    const wrong = [
      { ...body, completionPercent: 101 },
      { ...body, rows: [{ ...body.rows[0], status: 'passed' }] },
      { ...body, path: { ...body.path, courseIds: [] } },
    ];
    expect(wrong.map((value) => PathReportResponseSchema.safeParse(value).success)).toEqual([
      false,
      false,
      false,
    ]);
    expect(PathReportQuerySchema.parse({})).toEqual({});
    expect(PathReportQuerySchema.parse({ format: 'csv' })).toEqual({ format: 'csv' });
    expect(PathReportQuerySchema.safeParse({ format: 'pdf' }).success).toBe(false);
  });
});
