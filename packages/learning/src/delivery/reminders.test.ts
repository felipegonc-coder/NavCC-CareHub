import { describe, expect, it } from 'vitest';
import type { CourseStatus } from '../format/index';
import { addDays, daysBetween } from '../util/index';
import { assignmentNotice, remindersDue, type SentReminder } from './index';

type Plan = {
  dueDate?: string;
  required?: boolean;
  statusOn?: (day: string) => CourseStatus;
  skip?: string[];
};

/** Runs the daily reminders job from `from` to `to` (inclusive) and returns everything it sent. */
function simulate(from: string, to: string, plan: Plan = {}): string[] {
  const log: SentReminder[] = [];
  for (let day = from; daysBetween(day, to) >= 0; day = addDays(day, 1)) {
    if (plan.skip?.includes(day)) continue;
    const assignment = {
      ...(plan.dueDate !== undefined && { dueDate: plan.dueDate }),
      required: plan.required ?? true,
      status: plan.statusOn?.(day) ?? 'not_started',
    };
    for (const kind of remindersDue(assignment, log, day)) log.push({ kind, on: day });
  }
  return log.map((sent) => `${sent.on} ${sent.kind}`);
}

const finishedFrom =
  (first: string, status: CourseStatus = 'passed') =>
  (day: string) =>
    daysBetween(first, day) >= 0 ? status : 'in_progress';

describe('remindersDue, day by day', () => {
  it('sends assigned, due soon the day before, then overdue the day after and every 3 days', () => {
    expect(simulate('2026-10-19', '2026-11-08', { dueDate: '2026-10-30' })).toEqual([
      '2026-10-19 assigned',
      '2026-10-29 due_soon',
      '2026-10-31 overdue',
      '2026-11-03 overdue',
      '2026-11-06 overdue',
    ]);
  });

  it('stops once the course is completed or passed', () => {
    const plan = { dueDate: '2026-10-30', statusOn: finishedFrom('2026-11-04', 'completed') };
    expect(simulate('2026-10-19', '2026-11-20', plan)).toEqual([
      '2026-10-19 assigned',
      '2026-10-29 due_soon',
      '2026-10-31 overdue',
      '2026-11-03 overdue',
    ]);
  });

  it('keeps nudging after a failed attempt, since failed is not finished', () => {
    const plan = { dueDate: '2026-10-30', statusOn: finishedFrom('2026-10-25', 'failed') };
    expect(simulate('2026-10-19', '2026-11-03', plan)).toEqual([
      '2026-10-19 assigned',
      '2026-10-29 due_soon',
      '2026-10-31 overdue',
      '2026-11-03 overdue',
    ]);
  });

  it('sends only assigned on the day of the assignment, even close to the due date', () => {
    expect(simulate('2026-10-29', '2026-11-01', { dueDate: '2026-10-30' })).toEqual([
      '2026-10-29 assigned',
      '2026-10-30 due_soon',
      '2026-10-31 overdue',
    ]);
    expect(simulate('2026-10-30', '2026-11-03', { dueDate: '2026-10-30' })).toEqual([
      '2026-10-30 assigned',
      '2026-10-31 overdue',
      '2026-11-03 overdue',
    ]);
  });

  it('handles assignments made after their due date', () => {
    expect(simulate('2026-11-02', '2026-11-06', { dueDate: '2026-10-30' })).toEqual([
      '2026-11-02 assigned',
      '2026-11-03 overdue',
      '2026-11-06 overdue',
    ]);
  });

  it('gives optional and undated assignments only the assigned message', () => {
    expect(
      simulate('2026-10-19', '2026-11-08', { dueDate: '2026-10-30', required: false }),
    ).toEqual(['2026-10-19 assigned']);
    expect(simulate('2026-10-19', '2026-11-08')).toEqual(['2026-10-19 assigned']);
  });

  it('sends nothing for a course finished before it was assigned', () => {
    expect(
      simulate('2026-10-19', '2026-11-08', { dueDate: '2026-10-30', statusOn: () => 'passed' }),
    ).toEqual([]);
  });

  it("catches up after days the job didn't run, without a late due-soon", () => {
    const skip = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-03'];
    expect(simulate('2026-10-19', '2026-11-08', { dueDate: '2026-10-30', skip })).toEqual([
      '2026-10-19 assigned',
      '2026-11-01 overdue',
      '2026-11-04 overdue',
      '2026-11-07 overdue',
    ]);
  });

  it('sends nothing new when it runs twice on the same day', () => {
    const assignment = { dueDate: '2026-10-30', required: true, status: 'in_progress' as const };
    const log: SentReminder[] = [{ kind: 'assigned', on: '2026-10-19' }];
    expect(remindersDue(assignment, log, '2026-10-29')).toEqual(['due_soon']);
    log.push({ kind: 'due_soon', on: '2026-10-29' });
    expect(remindersDue(assignment, log, '2026-10-29')).toEqual([]);
    expect(remindersDue(assignment, [], '2026-10-29')).toEqual(['assigned']);
  });
});

describe('assignmentNotice', () => {
  const fire = { id: 'c-fire', title: 'Fire safety basics' };
  const course = [{ label: 'Open course', href: '/learning/courses/c-fire' }];
  const myLearning = [{ label: 'Open My learning', href: '/learning' }];
  const notice = (
    kind: 'assigned' | 'due_soon' | 'overdue',
    today: string,
    canOpen: boolean,
    dueDate?: string,
  ) => assignmentNotice(kind, fire, { today, dueDate, canOpen });

  it('words each reminder of the day-by-day run, relative to the day it goes out', () => {
    const texts = simulate('2026-10-19', '2026-11-08', { dueDate: '2026-10-30' }).map((line) => {
      const [day = '', kind] = line.split(' ') as [string, 'assigned' | 'due_soon' | 'overdue'];
      return notice(kind, day, true, '2026-10-30').text;
    });
    expect(texts).toEqual([
      "You've been assigned “Fire safety basics”, due in 11 days.",
      '“Fire safety basics” is due tomorrow.',
      '“Fire safety basics” was due yesterday.',
      '“Fire safety basics” was due 4 days ago.',
      '“Fire safety basics” was due 7 days ago.',
    ]);
  });

  it('names the course and links to it when the person can open it', () => {
    expect(notice('assigned', '2026-10-19', true)).toEqual({
      title: 'New course assigned',
      text: "You've been assigned “Fire safety basics”.",
      buttons: course,
    });
    expect(notice('assigned', '2026-11-02', true, '2026-10-30').text).toBe(
      "You've been assigned “Fire safety basics”, which was due 3 days ago.",
    );
    expect(notice('due_soon', '2026-10-30', true, '2026-10-30')).toEqual({
      title: 'Course due today',
      text: '“Fire safety basics” is due today.',
      buttons: course,
    });
    expect(notice('overdue', '2026-10-31', true, '2026-10-30').title).toBe('Course overdue');
  });

  it('keeps the course title and link out when the person might not have access', () => {
    const notices = [
      notice('assigned', '2026-10-19', false, '2026-10-30'),
      notice('due_soon', '2026-10-29', false, '2026-10-30'),
      notice('overdue', '2026-11-02', false, '2026-10-30'),
    ];
    expect(notices.map((item) => item.text)).toEqual([
      'You have a new course to take, due in 11 days.',
      'One of your courses is due tomorrow.',
      'One of your courses was due 3 days ago.',
    ]);
    for (const item of notices) {
      expect(item.buttons).toEqual(myLearning);
      expect(JSON.stringify(item)).not.toMatch(/Fire safety|c-fire/);
    }
  });
});
