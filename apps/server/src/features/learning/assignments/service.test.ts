import {
  CreateAssignmentsRequestSchema,
  sampleCertificationCourse,
  sampleMicrolearningCourse,
  sampleRequiredReadCourse,
  sampleStandardCourse,
  type CreateAssignmentsRequest,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import {
  createAssignments,
  deleteAssignment,
  learnerAssignments,
  listAssignments,
  myLearningFor,
  todayIn,
  type CourseProgress,
} from './service';
import { memorySources, only, type MemoryWorld } from './testing';

// Fictional people and courses only.
const workspace = '00000000-0000-4000-8000-000000000001';
const otherWorkspace = '00000000-0000-4000-8000-000000000002';
const trainer = '00000000-0000-4000-8000-00000000000a';
const tara = '00000000-0000-4000-8000-00000000000b';
const omar = '00000000-0000-4000-8000-00000000000c';
const priya = '00000000-0000-4000-8000-00000000000d';
const frontDesk = 'group-front-desk';
const actor = { userId: trainer, workspaceId: workspace };
const today = '2026-10-27';
const now = () => new Date('2026-10-27T15:00:00Z');

const calls = sampleStandardCourse;
const privacy = sampleRequiredReadCourse;
const hold = sampleMicrolearningCourse;
const escalations = sampleCertificationCourse;

const request = (input: CreateAssignmentsRequest) => CreateAssignmentsRequestSchema.parse(input);
const toCourse = (id: string) => ({ type: 'course' as const, id });

/** What `promise` rejects with, or null when it resolves. */
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe('createAssignments', () => {
  it('assigns a published course to people and groups, each once', async () => {
    const sources = memorySources({ courses: [calls], now });
    const input = request({
      target: toCourse(calls.id),
      people: [tara, tara],
      groups: [frontDesk, frontDesk],
      dueDate: '2026-11-15',
    });

    const made = await createAssignments(sources, actor, input, today);

    expect(made).toEqual([
      {
        id: sources.store.rows[0]?.id,
        courseId: calls.id,
        courseTitle: calls.title,
        pathId: null,
        people: [tara],
        groups: [frontDesk],
        dueDate: '2026-11-15',
        dueInDays: null,
        required: true,
        createdBy: trainer,
        createdAt: '2026-10-27T15:00:00.000Z',
      },
    ]);
    expect(sources.store.learnerRows).toEqual([]);
  });

  it('refuses past due dates, unpublished courses and paths with none published', async () => {
    const sources = memorySources({
      courses: [calls],
      paths: { 'path-drafts': [privacy.id] },
      now,
    });
    const yesterday = request({
      target: toCourse(calls.id),
      people: [tara],
      dueDate: '2026-10-26',
    });

    expect(await rejection(createAssignments(sources, actor, yesterday, today))).toMatchObject({
      status: 400,
      issues: [{ path: 'dueDate', message: 'Choose today or a later day.' }],
    });
    const draft = request({ target: toCourse(privacy.id), people: [tara] });
    expect(await rejection(createAssignments(sources, actor, draft, today))).toMatchObject({
      status: 404,
    });
    const nowhere = request({ target: { type: 'path', id: 'path-missing' }, people: [tara] });
    expect(await rejection(createAssignments(sources, actor, nowhere, today))).toMatchObject({
      status: 404,
    });
    const drafts = request({ target: { type: 'path', id: 'path-drafts' }, people: [tara] });
    expect(await rejection(createAssignments(sources, actor, drafts, today))).toMatchObject({
      status: 409,
      message: 'None of the courses on this path is published yet. Publish one first.',
    });
    expect(sources.store.rows).toEqual([]);

    const dueToday = request({ target: toCourse(calls.id), people: [tara], dueDate: today });
    expect(await createAssignments(sources, actor, dueToday, today)).toHaveLength(1);
  });

  it("assigns each published course on a path once, in the path's order", async () => {
    const sources = memorySources({
      courses: [calls, escalations],
      paths: { 'path-new-starter': [calls.id, privacy.id, escalations.id, calls.id] },
      now,
    });
    const input = request({
      target: { type: 'path', id: 'path-new-starter' },
      people: [tara],
      required: false,
    });

    const made = await createAssignments(sources, actor, input, today);

    expect(made.map(({ courseId, pathId, required }) => [courseId, pathId, required])).toEqual([
      [calls.id, 'path-new-starter', false],
      [escalations.id, 'path-new-starter', false],
    ]);
  });

  it('starts "due in N days" today for everyone the assignment reaches now', async () => {
    const sources = memorySources({ courses: [calls], groups: { [frontDesk]: [tara, omar] }, now });
    const input = request({
      target: toCourse(calls.id),
      people: [omar, priya],
      groups: [frontDesk, 'group-gone'],
      dueInDays: 14,
    });

    const [made] = await createAssignments(sources, actor, input, today);

    expect(sources.store.learnerRows).toEqual(
      [omar, priya, tara].map((userId) => ({ assignmentId: made?.id, userId, since: today })),
    );
  });
});

describe('listAssignments and deleteAssignment', () => {
  it('stay in one workspace', async () => {
    const world: MemoryWorld = { courses: [calls, privacy], now };
    const sources = memorySources(world);
    const assign = async (workspaceId: string, courseId: string) => {
      const input = request({ target: toCourse(courseId), people: [tara] });
      return only(await createAssignments(sources, { ...actor, workspaceId }, input, today));
    };
    const first = await assign(workspace, calls.id);
    const second = await assign(workspace, privacy.id);
    const elsewhere = await assign(otherWorkspace, calls.id);
    const ids = async (courseId?: string) =>
      (await listAssignments(sources, workspace, courseId)).map((assignment) => assignment.id);

    expect(await ids()).toEqual([first.id, second.id]);
    expect(await ids(privacy.id)).toEqual([second.id]);

    world.courses = [privacy];
    expect((await listAssignments(sources, workspace)).map((a) => a.courseTitle)).toEqual([
      null,
      privacy.title,
    ]);

    expect(await rejection(deleteAssignment(sources, workspace, elsewhere.id))).toMatchObject({
      status: 404,
    });
    await deleteAssignment(sources, workspace, first.id);
    expect(await rejection(deleteAssignment(sources, workspace, first.id))).toMatchObject({
      status: 404,
    });
    expect(await ids()).toEqual([second.id]);
    expect((await listAssignments(sources, otherWorkspace)).map((a) => a.id)).toEqual([
      elsewhere.id,
    ]);
  });
});

describe('learnerAssignments', () => {
  it("merges each person's assignments: the earliest due date and required win", async () => {
    const sources = memorySources({ courses: [calls], groups: { [frontDesk]: [tara, omar] }, now });
    const [direct] = await createAssignments(
      sources,
      actor,
      request({
        target: toCourse(calls.id),
        people: [tara],
        dueDate: '2026-11-20',
        required: false,
      }),
      today,
    );
    const [group] = await createAssignments(
      sources,
      actor,
      request({ target: toCourse(calls.id), groups: [frontDesk], dueDate: '2026-11-10' }),
      today,
    );

    const everyone = await learnerAssignments(sources, workspace, today);

    expect(everyone).toEqual([
      {
        learnerId: tara,
        courseId: calls.id,
        dueDate: '2026-11-10',
        required: true,
        assignmentId: group?.id,
        assignmentIds: [direct?.id, group?.id],
      },
      {
        learnerId: omar,
        courseId: calls.id,
        dueDate: '2026-11-10',
        required: true,
        assignmentId: group?.id,
        assignmentIds: [group?.id],
      },
    ]);
    expect(await learnerAssignments(sources, workspace, today, omar)).toEqual([everyone[1]]);
    expect(await learnerAssignments(sources, workspace, today, priya)).toEqual([]);
    expect(await learnerAssignments(sources, otherWorkspace, today, tara)).toEqual([]);
  });

  it('counts "due in N days" from the day each person got the course', async () => {
    const world: MemoryWorld = { courses: [calls], groups: { [frontDesk]: [tara] }, now };
    const sources = memorySources(world);
    const input = request({
      target: toCourse(calls.id),
      people: [omar],
      groups: [frontDesk],
      dueInDays: 14,
    });
    await createAssignments(sources, actor, input, today);
    const dueDates = async (day: string, userId?: string) =>
      (await learnerAssignments(sources, workspace, day, userId)).map((a) => [
        a.learnerId,
        a.dueDate,
      ]);

    world.groups = { [frontDesk]: [tara, priya] };
    expect(await dueDates('2026-11-02')).toEqual([
      [omar, '2026-11-10'],
      [tara, '2026-11-10'],
      [priya, '2026-11-16'],
    ]);
    expect(await dueDates('2026-11-05', priya)).toEqual([[priya, '2026-11-16']]);

    world.groups = { [frontDesk]: [priya] };
    expect(await dueDates('2026-11-05')).toEqual([
      [omar, '2026-11-10'],
      [priya, '2026-11-16'],
    ]);
  });

  it("counts from the assignment's day in Care Hub's zone when no start was kept", async () => {
    const sources = memorySources({
      courses: [calls],
      now: () => new Date('2026-10-28T03:00:00Z'),
    });
    const [row] = await sources.store.insert([
      {
        workspaceId: workspace,
        courseId: calls.id,
        pathId: null,
        userIds: [tara],
        groupIds: [],
        dueDate: null,
        dueInDays: 7,
        required: true,
        createdBy: trainer,
      },
    ]);

    const [mine] = await learnerAssignments(sources, workspace, '2026-10-30', tara);

    expect(mine?.dueDate).toBe('2026-11-03');
    expect(sources.store.learnerRows).toEqual([
      { assignmentId: row?.id, userId: tara, since: '2026-10-27' },
    ]);
  });
});

describe('myLearningFor', () => {
  it("sorts one person's courses into My learning with in-app links", async () => {
    const world: MemoryWorld = { courses: [calls, privacy, hold, escalations], now };
    const sources = memorySources(world);
    const assign = (courseId: string, dueDate?: string) =>
      createAssignments(
        sources,
        actor,
        request({ target: toCourse(courseId), people: [tara], ...(dueDate && { dueDate }) }),
        '2026-10-01',
      );
    await assign(calls.id, '2026-11-30');
    await assign(privacy.id, '2026-10-24');
    await assign(hold.id);
    const retired = { ...hold, id: 'course-retired', title: 'Retired course' };
    world.courses = [calls, privacy, hold, escalations, retired];
    await assign(retired.id);
    world.courses = [calls, privacy, hold, escalations];
    const progress = (
      userId: string,
      courseId: string,
      status: CourseProgress['status'],
      percentComplete: number,
      completedAt: string | null = null,
    ): CourseProgress => ({
      userId,
      courseId,
      status,
      percentComplete,
      startedAt: '2026-10-20T16:00:00Z',
      completedAt,
      lastActivityAt: '2026-10-26T16:00:00Z',
    });
    world.progress = [
      progress(tara, calls.id, 'in_progress', 42.6),
      progress(tara, escalations.id, 'passed', 130, '2026-10-25T16:00:00Z'),
      progress(omar, privacy.id, 'completed', 100, '2026-10-25T16:00:00Z'),
    ];

    const page = await myLearningFor(
      sources,
      { userId: tara, workspaceId: workspace },
      today,
      'UTC',
    );

    expect(page.continue).toEqual([
      {
        courseId: calls.id,
        title: calls.title,
        summary: calls.summary,
        cover: calls.cover,
        estimatedMinutes: calls.estimatedMinutes,
        status: 'in_progress',
        progressPercent: 43,
        assigned: true,
        required: true,
        dueDate: '2026-11-30',
        dueStatus: 'upcoming',
        lastActivityAt: '2026-10-26T16:00:00Z',
        completedAt: null,
        href: '/learning/courses/course-calls-with-care',
      },
    ]);
    const brief = (entries: typeof page.assigned) =>
      entries.map((entry) => [entry.courseId, entry.dueStatus, entry.progressPercent, entry.href]);
    expect(brief(page.overdue)).toEqual([
      [privacy.id, 'overdue', 0, '/learning/courses/course-privacy-basics'],
    ]);
    expect(brief(page.assigned)).toEqual([
      [hold.id, 'none', 0, '/learning/courses/course-two-minute-hold'],
    ]);
    expect(brief(page.finished)).toEqual([
      [escalations.id, 'none', 100, '/learning/courses/course-escalations-cert'],
    ]);
    expect(page.finished[0]).toMatchObject({
      assigned: false,
      completedAt: '2026-10-25T16:00:00Z',
    });
  });
});

describe('todayIn', () => {
  const at = new Date('2026-10-27T03:00:00Z');

  it("uses the person's time zone, or Care Hub's when it isn't one", () => {
    expect(todayIn('Asia/Tokyo', at)).toEqual({ today: '2026-10-27', timeZone: 'Asia/Tokyo' });
    expect(todayIn('Mars/Olympus_Mons', at)).toEqual({
      today: '2026-10-26',
      timeZone: 'America/Denver',
    });
    expect(todayIn(undefined, at)).toEqual({ today: '2026-10-26', timeZone: 'America/Denver' });
  });
});
