import {
  addDays,
  CreateAssignmentsRequestSchema,
  sampleCertificationCourse,
  sampleMicrolearningCourse,
  sampleRequiredReadCourse,
  sampleScenarioLabCourse,
  sampleShowcaseCourse,
  sampleStandardCourse,
} from '@carehub/learning';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindAssignmentSources,
  createAssignments,
  todayIn,
  type CourseProgress,
} from './assignments/service';
import { memorySources, only } from './assignments/testing';
import { isLearningEnabled, listLearningDueDates, listMyLearning } from './public';

// Fictional people and courses only. Calendar and Home pass the signed-in person's own id
// (decision 0310); each answer must hold only that person's items, with in-app links.
const workspace = '00000000-0000-4000-8000-000000000001';
const trainer = '00000000-0000-4000-8000-00000000000a';
const tara = '00000000-0000-4000-8000-00000000000b';
const omar = '00000000-0000-4000-8000-00000000000c';
const frontDesk = 'group-front-desk';
const timeZone = 'UTC';
const today = todayIn(timeZone).today;
const day = (offset: number) => addDays(today, offset);

const calls = sampleStandardCourse;
const privacy = sampleRequiredReadCourse;
const hold = sampleMicrolearningCourse;
const escalations = sampleCertificationCourse;
const upset = sampleScenarioLabCourse;
const showcase = sampleShowcaseCourse;
/** A course whose id can't make a /learning/ link (the tables refuse such ids). */
const hostile = { ...hold, id: '../../admin', title: 'Not a Learning page' };

const progress = (courseId: string, status: CourseProgress['status'], percent: number) => ({
  userId: tara,
  courseId,
  status,
  percentComplete: percent,
  startedAt: `${day(-20)}T16:00:00.000Z`,
  completedAt: status === 'in_progress' ? null : `${day(-2)}T16:00:00.000Z`,
  lastActivityAt: `${day(-2)}T16:00:00.000Z`,
  previousFinishedAt: null,
});

/** Tara and Omar's assignments, all made ten days ago, bound as the running server would. */
async function bindExample() {
  const sources = memorySources({
    courses: [calls, privacy, hold, escalations, upset, showcase, hostile],
    groups: { [frontDesk]: [tara, omar] },
    progress: [
      progress(calls.id, 'in_progress', 50),
      progress(escalations.id, 'passed', 100),
      progress(showcase.id, 'completed', 100),
    ],
  });
  const assign = async (
    courseId: string,
    to: { people?: string[]; groups?: string[] },
    due?: number,
  ) => {
    const input = CreateAssignmentsRequestSchema.parse({
      target: { type: 'course', id: courseId },
      ...to,
      ...(due !== undefined && { dueDate: day(due) }),
    });
    const made = await createAssignments(
      sources,
      { userId: trainer, workspaceId: workspace },
      input,
      day(-10),
    );
    return only(made).id;
  };
  const ids = {
    privacy: await assign(privacy.id, { groups: [frontDesk] }, -3),
    escalations: await assign(escalations.id, { people: [tara] }, -1),
    calls: await assign(calls.id, { people: [tara] }, 10),
    hold: await assign(hold.id, { people: [tara] }, 4),
    upset: await assign(upset.id, { people: [tara] }),
    omarsCalls: await assign(calls.id, { people: [omar] }, 1),
  };
  await sources.store.insert([
    {
      workspaceId: workspace,
      courseId: hostile.id,
      pathId: null,
      userIds: [tara],
      groupIds: [],
      dueDate: day(2),
      dueInDays: null,
      required: true,
      createdBy: trainer,
    },
  ]);
  bindAssignmentSources(sources);
  return ids;
}

const link = (courseId: string) => `/learning/courses/${courseId}`;

afterEach(() => bindAssignmentSources(null));

describe('isLearningEnabled', () => {
  it('follows the workspace setting while the Learning API runs', async () => {
    expect(await isLearningEnabled(workspace)).toBe(false);
    await bindExample();
    expect(await isLearningEnabled(workspace)).toBe(true);
    expect(await isLearningEnabled('everywhere')).toBe(false);
    const switchedOff = '00000000-0000-4000-8000-000000000002';
    bindAssignmentSources(memorySources({ learningOff: [switchedOff] }));
    expect(await isLearningEnabled(switchedOff)).toBe(false);
    expect(await isLearningEnabled(workspace)).toBe(true);
  });
});

describe('listLearningDueDates', () => {
  const query = (userId: string, from: number, to: number) => ({
    userId,
    workspaceId: workspace,
    from: day(from),
    to: day(to),
    timeZone,
  });

  it("lists the person's own unfinished due dates, by date, with in-app links", async () => {
    const ids = await bindExample();

    const dates = await listLearningDueDates(query(tara, -30, 30));

    expect(dates).toEqual([
      {
        assignmentId: ids.privacy,
        courseId: privacy.id,
        title: privacy.title,
        dueDate: day(-3),
        href: link(privacy.id),
      },
      {
        assignmentId: ids.hold,
        courseId: hold.id,
        title: hold.title,
        dueDate: day(4),
        href: link(hold.id),
      },
      {
        assignmentId: ids.calls,
        courseId: calls.id,
        title: calls.title,
        dueDate: day(10),
        href: link(calls.id),
      },
    ]);
    expect(dates.every((date) => date.href.startsWith('/learning/'))).toBe(true);
    expect(
      (await listLearningDueDates(query(omar, -30, 30))).map((date) => date.assignmentId),
    ).toEqual([ids.privacy, ids.omarsCalls]);
    expect((await listLearningDueDates(query(tara, 0, 5))).map((date) => date.courseId)).toEqual([
      hold.id,
    ]);
    expect(await listLearningDueDates(query(tara, 5, 0))).toEqual([]);
  });
});

describe('listMyLearning', () => {
  const query = (userId: string, limit: number) => ({
    userId,
    workspaceId: workspace,
    limit,
    timeZone,
  });

  it("lists the person's own current courses, overdue first, then by due date", async () => {
    await bindExample();

    const items = await listMyLearning(query(tara, 10));

    expect(items).toEqual([
      {
        courseId: privacy.id,
        title: privacy.title,
        dueDate: day(-3),
        overdue: true,
        progressPercent: 0,
        href: link(privacy.id),
      },
      {
        courseId: hold.id,
        title: hold.title,
        dueDate: day(4),
        overdue: false,
        progressPercent: 0,
        href: link(hold.id),
      },
      {
        courseId: calls.id,
        title: calls.title,
        dueDate: day(10),
        overdue: false,
        progressPercent: 50,
        href: link(calls.id),
      },
      {
        courseId: upset.id,
        title: upset.title,
        dueDate: null,
        overdue: false,
        progressPercent: 0,
        href: link(upset.id),
      },
    ]);
    expect(items.every((item) => item.href.startsWith('/learning/'))).toBe(true);
    expect((await listMyLearning(query(tara, 2))).map((item) => item.courseId)).toEqual([
      privacy.id,
      hold.id,
    ]);
    expect(
      (await listMyLearning(query(omar, 10))).map((item) => [item.courseId, item.dueDate]),
    ).toEqual([
      [privacy.id, day(-3)],
      [calls.id, day(1)],
    ]);
  });
});

describe('Learning for other lanes', () => {
  it('refuses anything but one person and a sensible range or limit', async () => {
    await bindExample();
    const dates = { userId: tara, workspaceId: workspace, from: day(0), to: day(5) };
    const home = { userId: tara, workspaceId: workspace, limit: 5 };

    await expect(listLearningDueDates({ ...dates, userId: 'everyone' })).rejects.toThrow();
    await expect(listLearningDueDates({ ...dates, workspaceId: '' })).rejects.toThrow();
    await expect(listLearningDueDates({ ...dates, from: 'soon' })).rejects.toThrow();
    await expect(listMyLearning({ ...home, userId: `${tara},${omar}` })).rejects.toThrow();
    await expect(listMyLearning({ ...home, limit: 0 })).rejects.toThrow();
    await expect(listMyLearning({ ...home, limit: 101 })).rejects.toThrow();
  });

  it('answers with nothing while the Learning API is off', async () => {
    expect(
      await listLearningDueDates({
        userId: tara,
        workspaceId: workspace,
        from: day(-30),
        to: day(30),
      }),
    ).toEqual([]);
    expect(await listMyLearning({ userId: tara, workspaceId: workspace, limit: 5 })).toEqual([]);
  });
});
