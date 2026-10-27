import {
  addDays,
  CreateAssignmentsRequestSchema,
  sampleRequiredReadCourse,
  sampleStandardCourse,
  type CreateAssignmentsRequest,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import type { SendNoticeInput } from '../../notices';
import { sendReminders, type ReminderSources, type SentReminderRow } from './reminders';
import { createAssignments, type CourseProgress } from './service';
import { memorySources, type MemoryWorld } from './testing';

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

/** Memory sources with a reminder log and an outbox; `canOpen` lists "userId courseId". */
function reminderSources(world: MemoryWorld, canOpen: string[] = []) {
  const base = memorySources(world);
  const log: SentReminderRow[] = [];
  const notices: SendNoticeInput[] = [];
  const sameRow = (a: SentReminderRow) => (b: SentReminderRow) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const sources: ReminderSources = {
    ...base,
    workspaces: async () => [...new Set(base.store.rows.map((row) => row.workspaceId))],
    sentReminders: async (workspaceId, userIds) =>
      log.filter((row) => row.workspaceId === workspaceId && userIds.includes(row.userId)),
    async logReminder(row) {
      if (log.some(sameRow(row))) return false;
      log.push(row);
      return true;
    },
    canOpen: async (_workspaceId, userId, courseId) => canOpen.includes(`${userId} ${courseId}`),
    async sendNotice(notice) {
      notices.push(notice);
      return { noticeId: String(notices.length), grouped: false };
    },
  };
  const assign = (input: CreateAssignmentsRequest, workspaceId = workspace) =>
    createAssignments(
      sources,
      { userId: trainer, workspaceId },
      CreateAssignmentsRequestSchema.parse(input),
      firstDay,
    );
  return { sources, log, notices, assign };
}

const completed = (userId: string, courseId: string): CourseProgress => ({
  userId,
  courseId,
  status: 'completed',
  percentComplete: 100,
  startedAt: '2026-11-04T16:00:00Z',
  completedAt: '2026-11-04T17:00:00Z',
  lastActivityAt: '2026-11-04T17:00:00Z',
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
        buttons: [{ label: 'Open My learning', href: '/learning' }],
      },
      {
        workspaceId: otherWorkspace,
        userId: omar,
        kind: 'reminder',
        sender: 'Learning',
        title: 'New course assigned',
        text: 'You have a new course to take.',
        buttons: [{ label: 'Open My learning', href: '/learning' }],
      },
    ]);
  });

  it('sends nothing at night, for unpublished courses, twice, or once stopped', async () => {
    const world: MemoryWorld = { courses: [calls, privacy] };
    const { sources, log, notices, assign } = reminderSources(world);
    await assign({ target: { type: 'course', id: calls.id }, people: [tara] });
    await assign({ target: { type: 'course', id: privacy.id }, people: [tara] });

    expect(await sendReminders(sources, new Date(`${firstDay}T13:00:00Z`))).toBe(0);
    expect(await sendReminders(sources, new Date(`${firstDay}T02:30:00Z`))).toBe(0);
    expect(await sendReminders(sources, morning(firstDay), AbortSignal.abort())).toBe(0);
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
});
