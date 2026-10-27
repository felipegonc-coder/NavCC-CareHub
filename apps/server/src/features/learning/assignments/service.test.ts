import {
  CreateAssignmentsRequestSchema,
  sampleCertificationCourse,
  sampleMicrolearningCourse,
  sampleRequiredReadCourse,
  sampleStandardCourse,
  type CreateAssignmentsRequest,
  type MyLearningEntry,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import {
  assignRecertification,
  createAssignments,
  deleteAssignment,
  learnerAssignments,
  listAssignments,
  myLearningFor,
  RECERTIFICATION_ASSIGNER,
  syncPath,
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

describe('path assignments', () => {
  const path = { type: 'path' as const, id: 'path-new-starter' };

  it('go as a whole when any of their courses is removed', async () => {
    const sources = memorySources({
      courses: [calls, hold],
      paths: { [path.id]: [calls.id, hold.id] },
      now,
    });
    const [first] = await createAssignments(
      sources,
      actor,
      request({ target: path, people: [tara] }),
      today,
    );
    const own = only(
      await createAssignments(
        sources,
        actor,
        request({ target: toCourse(hold.id), people: [tara] }),
        today,
      ),
    );

    await deleteAssignment(sources, workspace, first?.id ?? '');

    expect(sources.store.rows.map((row) => row.id)).toEqual([own.id]);
  });

  it("follow the path's published courses", async () => {
    let clock = new Date('2026-10-27T15:00:00Z');
    const world: MemoryWorld = {
      courses: [calls, hold, escalations],
      paths: { [path.id]: [calls.id, escalations.id] },
      groups: { [frontDesk]: [omar] },
      now: () => clock,
    };
    const sources = memorySources(world);
    const first = request({ target: path, people: [tara], groups: [frontDesk], dueInDays: 14 });
    await createAssignments(sources, actor, first, today);
    clock = new Date('2026-10-28T09:00:00Z');
    const second = request({
      target: path,
      people: [priya],
      dueDate: '2026-11-30',
      required: false,
    });
    await createAssignments(sources, actor, second, '2026-10-28');
    const own = only(
      await createAssignments(
        sources,
        actor,
        request({ target: toCourse(hold.id), people: [tara] }),
        '2026-10-28',
      ),
    );

    const newCourses = [escalations.id, hold.id, privacy.id, hold.id];
    await syncPath(sources, workspace, path.id, newCourses, '2026-11-02');

    const rows = sources.store.rows.map((row) => ({
      courseId: row.courseId,
      pathId: row.pathId,
      people: row.userIds,
      due: row.dueDate ?? row.dueInDays,
      required: row.required,
      createdAt: row.createdAt.toISOString(),
    }));
    const fromFirst = {
      pathId: path.id,
      people: [tara],
      due: 14,
      required: true,
      createdAt: '2026-10-27T15:00:00.000Z',
    };
    const fromSecond = {
      pathId: path.id,
      people: [priya],
      due: '2026-11-30',
      required: false,
      createdAt: '2026-10-28T09:00:00.000Z',
    };
    expect(rows).toEqual([
      { courseId: escalations.id, ...fromFirst },
      { courseId: escalations.id, ...fromSecond },
      {
        courseId: hold.id,
        pathId: null,
        people: [tara],
        due: null,
        required: true,
        createdAt: '2026-10-28T09:00:00.000Z',
      },
      { courseId: hold.id, ...fromFirst },
      { courseId: hold.id, ...fromSecond },
    ]);
    const added = sources.store.rows.find((row) => row.courseId === hold.id && row.dueInDays);
    expect(sources.store.learnerRows.filter((row) => row.since === '2026-11-02')).toEqual([
      { assignmentId: added?.id, userId: tara, since: '2026-11-02' },
    ]);
    const kept = new Set(sources.store.rows.map((row) => row.id));
    expect(sources.store.learnerRows.every((row) => kept.has(row.assignmentId))).toBe(true);

    await syncPath(sources, workspace, path.id, [privacy.id], '2026-11-03');
    expect(sources.store.rows.map((row) => row.id)).toEqual([own.id]);
    await syncPath(sources, workspace, 'path-unused', [calls.id], '2026-11-03');
    expect(sources.store.rows).toHaveLength(1);
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

    const { assignments: everyone } = await learnerAssignments(sources, workspace, today);

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
    const mine = async (workspaceId: string, userId: string) =>
      (await learnerAssignments(sources, workspaceId, today, userId)).assignments;
    expect(await mine(workspace, omar)).toEqual([everyone[1]]);
    expect(await mine(workspace, priya)).toEqual([]);
    expect(await mine(otherWorkspace, tara)).toEqual([]);
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
      (await learnerAssignments(sources, workspace, day, userId)).assignments.map((a) => [
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

    const { assignments } = await learnerAssignments(sources, workspace, '2026-10-30', tara);
    const [mine] = assignments;

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
      previousFinishedAt: null,
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

describe('assignRecertification', () => {
  const renewal = {
    workspaceId: workspace,
    courseId: escalations.id,
    userId: tara,
    dueDate: '2026-11-25',
  };

  it('assigns the course again to the person, once per due date', async () => {
    const world: MemoryWorld = { courses: [escalations], now };
    const sources = memorySources(world);

    const id = await assignRecertification(sources, renewal);

    expect(await assignRecertification(sources, renewal)).toBe(id);
    expect(only(sources.store.rows)).toMatchObject({
      id,
      courseId: escalations.id,
      pathId: null,
      userIds: [tara],
      groupIds: [],
      dueDate: '2026-11-25',
      dueInDays: null,
      required: true,
      createdBy: RECERTIFICATION_ASSIGNER,
    });
    expect(await assignRecertification(sources, { ...renewal, courseId: calls.id })).toBeNull();
    world.learningOff = [workspace];
    expect(await assignRecertification(sources, { ...renewal, dueDate: '2027-11-25' })).toBeNull();
    expect(sources.store.rows).toHaveLength(1);
  });

  it('keeps rows done by an earlier run, and the new one open until finished', async () => {
    let clock = new Date('2025-10-01T15:00:00Z');
    const world: MemoryWorld = {
      courses: [escalations],
      groups: { [frontDesk]: [tara, omar] },
      now: () => clock,
    };
    const sources = memorySources(world);
    const assign = (input: CreateAssignmentsRequest) =>
      createAssignments(sources, actor, request(input), '2025-10-01');
    await assign({ target: toCourse(escalations.id), people: [tara], dueDate: '2025-10-30' });
    await assign({ target: toCourse(escalations.id), groups: [frontDesk], dueDate: '2025-11-15' });
    const run = (fields: Partial<CourseProgress>): CourseProgress => ({
      userId: tara,
      courseId: escalations.id,
      status: 'not_started',
      percentComplete: 0,
      startedAt: null,
      completedAt: null,
      lastActivityAt: null,
      previousFinishedAt: null,
      ...fields,
    });
    const firstFinish = '2025-10-25T16:00:00Z';
    clock = new Date('2026-10-27T15:00:00Z');
    await assignRecertification(sources, renewal);
    world.progress = [run({ previousFinishedAt: firstFinish })];
    const me = { userId: tara, workspaceId: workspace };
    const brief = (entries: readonly MyLearningEntry[]) =>
      entries.map((entry) => [entry.courseId, entry.dueDate, entry.dueStatus]);

    const { assignments } = await learnerAssignments(sources, workspace, today);
    expect(assignments.map((a) => [a.learnerId, a.dueDate])).toEqual([
      [omar, '2025-11-15'],
      [tara, '2026-11-25'],
    ]);
    const renewed = await myLearningFor(sources, me, today, 'UTC');
    expect(brief(renewed.assigned)).toEqual([[escalations.id, '2026-11-25', 'upcoming']]);
    expect([...renewed.overdue, ...renewed.finished]).toEqual([]);

    world.progress = [
      run({
        status: 'passed',
        percentComplete: 100,
        startedAt: '2026-10-30T16:00:00Z',
        completedAt: '2026-11-02T16:00:00Z',
        lastActivityAt: '2026-11-02T16:00:00Z',
        previousFinishedAt: firstFinish,
      }),
    ];
    const done = await myLearningFor(sources, me, '2026-11-03', 'UTC');
    expect(brief(done.finished)).toEqual([[escalations.id, '2026-11-25', 'done_on_time']]);
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
