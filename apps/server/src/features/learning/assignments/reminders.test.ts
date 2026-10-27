import {
  addDays,
  CreateAssignmentsRequestSchema,
  sampleRequiredReadCourse,
  sampleStandardCourse,
  type CreateAssignmentsRequest,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { sendAssignedNotices, sendReminders } from './reminders';
import { assignRecertification, createAssignments, type CourseProgress } from './service';
import { memoryReminderSources, type MemoryWorld } from './testing';

// Fictional people and courses only. 16:00 UTC is mid-morning in Care Hub's time zone (Denver).
const workspace = '00000000-0000-4000-8000-000000000001';
const otherWorkspace = '00000000-0000-4000-8000-000000000002';
const trainer = '00000000-0000-4000-8000-00000000000a';
const tara = '00000000-0000-4000-8000-00000000000b';
const omar = '00000000-0000-4000-8000-00000000000c';
const priya = '00000000-0000-4000-8000-00000000000d';
const NAMES: Record<string, string> = { [tara]: 'Tara', [omar]: 'Omar', [priya]: 'Priya' };
const frontDesk = 'group-front-desk';
const calls = sampleStandardCourse;
const privacy = sampleRequiredReadCourse;
const firstDay = '2026-10-27';
const morning = (day: string) => new Date(`${day}T16:00:00Z`);

/** Memory reminder sources, and assigning as the trainer on the first day. */
function reminderSources(world: MemoryWorld, canOpen: string[] = []) {
  const memory = memoryReminderSources(world, canOpen);
  const assign = (input: CreateAssignmentsRequest, workspaceId = workspace) =>
    createAssignments(
      memory.sources,
      { userId: trainer, workspaceId },
      CreateAssignmentsRequestSchema.parse(input),
      firstDay,
    );
  return { ...memory, assign };
}

const completed = (userId: string, courseId: string): CourseProgress => ({
  userId,
  courseId,
  status: 'completed',
  percentComplete: 100,
  startedAt: '2026-11-04T16:00:00Z',
  completedAt: '2026-11-04T17:00:00Z',
  lastActivityAt: '2026-11-04T17:00:00Z',
  previousFinishedAt: null,
});

describe('sendReminders', () => {
  it('sends each reminder on its day, once, until the course is finished', async () => {
    const world: MemoryWorld = {
      courses: [calls, privacy],
      groups: { [frontDesk]: [omar] },
      now: () => morning(firstDay),
    };
    const { sources, log, assign } = reminderSources(world);
    await assign({
      target: { type: 'course', id: calls.id },
      people: [tara],
      dueDate: '2026-10-30',
    });
    await assign({
      target: { type: 'course', id: privacy.id },
      groups: [frontDesk],
      dueDate: '2026-10-29',
      required: false,
    });

    for (let offset = 0; offset <= 10; offset += 1) {
      const day = addDays(firstDay, offset);
      if (day === '2026-10-28') world.groups = { [frontDesk]: [omar, priya] };
      if (day === '2026-11-05') world.progress = [completed(tara, calls.id)];
      await sendReminders(sources, morning(day));
      expect(await sendReminders(sources, new Date(morning(day).getTime() + 3_600_000))).toBe(0);
    }

    expect(
      log.map((row) => `${row.sentOn} ${NAMES[row.userId]} ${row.courseId} ${row.kind}`),
    ).toEqual([
      '2026-10-27 Tara course-calls-with-care assigned',
      '2026-10-27 Omar course-privacy-basics assigned',
      '2026-10-28 Priya course-privacy-basics assigned',
      '2026-10-29 Tara course-calls-with-care due_soon',
      '2026-10-31 Tara course-calls-with-care overdue',
      '2026-11-03 Tara course-calls-with-care overdue',
    ]);
  });

  it('sends notices from Learning, naming the course only to people who may open it', async () => {
    const { sources, notices, assign } = reminderSources({ courses: [calls, privacy] }, [
      `${tara} ${calls.id}`,
    ]);
    await assign({
      target: { type: 'course', id: calls.id },
      people: [tara, omar],
      dueDate: '2026-10-30',
    });
    await assign({ target: { type: 'course', id: privacy.id }, people: [omar] }, otherWorkspace);

    expect(await sendReminders(sources, morning(firstDay))).toBe(3);

    expect(notices).toEqual([
      {
        workspaceId: workspace,
        userId: tara,
        kind: 'reminder',
        sender: 'Learning',
        title: 'New course assigned',
        text: `You've been assigned “${calls.title}”, due in 3 days.`,
        buttons: [{ label: 'Open course', href: `/learning/courses/${calls.id}` }],
      },
      {
        workspaceId: workspace,
        userId: omar,
        kind: 'reminder',
        sender: 'Learning',
        title: 'New course assigned',
        text: 'You have a new course to take, due in 3 days.',
        buttons: [{ label: 'Open course', href: `/learning/courses/${calls.id}` }],
      },
      {
        workspaceId: otherWorkspace,
        userId: omar,
        kind: 'reminder',
        sender: 'Learning',
        title: 'New course assigned',
        text: 'You have a new course to take.',
        buttons: [{ label: 'Open course', href: `/learning/courses/${privacy.id}` }],
      },
    ]);
  });

  it('starts over for a re-certification, as if nothing had been sent', async () => {
    let clock = morning('2025-10-27');
    const world: MemoryWorld = { courses: [calls], now: () => clock };
    const { sources, log } = reminderSources(world);
    await createAssignments(
      sources,
      { userId: trainer, workspaceId: workspace },
      CreateAssignmentsRequestSchema.parse({
        target: { type: 'course', id: calls.id },
        people: [tara],
        dueDate: '2025-10-30',
      }),
      '2025-10-27',
    );
    await sendReminders(sources, morning('2025-10-27'));
    await sendReminders(sources, morning('2025-10-29'));
    const finished = { ...completed(tara, calls.id), completedAt: '2025-10-29T17:00:00Z' };
    world.progress = [finished];

    clock = morning(firstDay);
    await assignRecertification(sources, {
      workspaceId: workspace,
      courseId: calls.id,
      userId: tara,
      dueDate: '2026-10-30',
    });
    world.progress = [
      {
        ...finished,
        status: 'not_started',
        percentComplete: 0,
        startedAt: null,
        completedAt: null,
        lastActivityAt: null,
        previousFinishedAt: finished.completedAt,
      },
    ];
    await sendReminders(sources, morning(firstDay));
    await sendReminders(sources, morning('2026-10-29'));

    expect(log.map((row) => `${row.sentOn} ${row.kind}`)).toEqual([
      '2025-10-27 assigned',
      '2025-10-29 due_soon',
      '2026-10-27 assigned',
      '2026-10-29 due_soon',
    ]);
  });

  it('sends nothing at night, with Learning off, for unpublished courses or twice', async () => {
    const world: MemoryWorld = { courses: [calls, privacy] };
    const { sources, log, notices, assign } = reminderSources(world);
    await assign({ target: { type: 'course', id: calls.id }, people: [tara] });
    await assign({ target: { type: 'course', id: privacy.id }, people: [tara] });

    expect(await sendReminders(sources, new Date(`${firstDay}T13:00:00Z`))).toBe(0);
    expect(await sendReminders(sources, new Date(`${firstDay}T02:30:00Z`))).toBe(0);
    expect(await sendReminders(sources, morning(firstDay), AbortSignal.abort())).toBe(0);
    world.learningOff = [workspace];
    expect(await sendReminders(sources, morning(firstDay))).toBe(0);
    world.learningOff = [];
    expect(log).toEqual([]);

    world.courses = [calls];
    await sources.logReminder({
      workspaceId: workspace,
      userId: tara,
      courseId: calls.id,
      kind: 'assigned',
      sentOn: firstDay,
    });
    expect(await sendReminders(sources, morning(firstDay))).toBe(0);
    expect(notices).toEqual([]);
  });

  it('sends the rest when a notice does not go out, and that one on the next run', async () => {
    const world: MemoryWorld = { courses: [calls], now: () => morning(firstDay) };
    const { sources, log, notices, outbox, assign } = reminderSources(world);
    await assign({ target: { type: 'course', id: calls.id }, people: [tara, omar, priya] });
    outbox.failing = (notice) => notice.userId === omar;

    await expect(sendReminders(sources, morning(firstDay))).rejects.toThrow(
      'Learning: 1 of 3 notices did not go out; the next run tries again.',
    );
    expect(notices.map((notice) => NAMES[notice.userId])).toEqual(['Tara', 'Priya']);
    expect(log.map((row) => NAMES[row.userId])).toEqual(['Tara', 'Priya']);

    outbox.failing = false;
    const nextRun = new Date(morning(firstDay).getTime() + 3_600_000);
    expect(await sendReminders(sources, nextRun)).toBe(1);
    expect(notices.map((notice) => NAMES[notice.userId])).toEqual(['Tara', 'Priya', 'Omar']);
  });
});

describe('sendAssignedNotices', () => {
  it('tells the people an assignment reaches at once, at any hour, and only once', async () => {
    // 22:00 in Care Hub's time zone: the job is quiet, but people hear about new courses.
    const evening = new Date(`2026-10-28T04:00:00Z`);
    const world: MemoryWorld = {
      courses: [calls, privacy],
      groups: { [frontDesk]: [omar] },
      now: () => evening,
    };
    const { sources, log, notices, assign } = reminderSources(world, [`${tara} ${calls.id}`]);
    await assign({ target: { type: 'course', id: privacy.id }, people: [priya] });
    const made = await assign({
      target: { type: 'course', id: calls.id },
      people: [tara],
      groups: [frontDesk],
      dueDate: '2026-11-06',
    });
    const ids = made.map((assignment) => assignment.id);

    expect(await sendReminders(sources, evening)).toBe(0);
    expect(await sendAssignedNotices(sources, workspace, ids, evening)).toBe(2);
    expect(await sendAssignedNotices(sources, workspace, ids, evening)).toBe(0);
    expect(notices.map((notice) => [NAMES[notice.userId], notice.title, notice.text])).toEqual([
      ['Tara', 'New course assigned', `You've been assigned “${calls.title}”, due in 10 days.`],
      ['Omar', 'New course assigned', 'You have a new course to take, due in 10 days.'],
    ]);
    expect(log.map((row) => [NAMES[row.userId], row.kind, row.sentOn])).toEqual([
      ['Tara', 'assigned', firstDay],
      ['Omar', 'assigned', firstDay],
    ]);

    // The next morning the job tells only Priya, whose course was assigned without a notice.
    expect(await sendReminders(sources, morning('2026-10-28'))).toBe(1);
    expect(notices.map((notice) => NAMES[notice.userId])).toEqual(['Tara', 'Omar', 'Priya']);
    world.learningOff = [workspace];
    const later = await assign({ target: { type: 'course', id: privacy.id }, people: [omar] });
    const laterIds = later.map((assignment) => assignment.id);
    expect(await sendAssignedNotices(sources, workspace, laterIds, evening)).toBe(0);
    expect(await sendAssignedNotices(sources, workspace, [], evening)).toBe(0);
  });

  it('leaves the notices that did not go out to the job', async () => {
    const world: MemoryWorld = { courses: [calls], now: () => morning(firstDay) };
    const { sources, log, notices, outbox, assign } = reminderSources(world);
    const made = await assign({ target: { type: 'course', id: calls.id }, people: [tara] });
    const ids = made.map((assignment) => assignment.id);
    outbox.failing = true;

    await expect(sendAssignedNotices(sources, workspace, ids, morning(firstDay))).rejects.toThrow(
      'Learning: 1 of 1 notices did not go out',
    );
    expect(log).toEqual([]);
    outbox.failing = false;
    expect(await sendReminders(sources, morning(firstDay))).toBe(1);
    expect(notices.map((notice) => [NAMES[notice.userId], notice.title])).toEqual([
      ['Tara', 'New course assigned'],
    ]);
  });
});
