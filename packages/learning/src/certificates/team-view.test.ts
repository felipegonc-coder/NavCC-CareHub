// The team view as CSV and over the wire: one line per group.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { teamView, type EnrollmentRow, type TeamViewEntry } from '../reports/index';
import {
  TeamViewEntrySchema,
  TeamViewQuerySchema,
  TeamViewResponseSchema,
  teamViewCsv,
} from './index';

/** True only when each type is assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Fictional people, groups and courses only.
const row = (
  learnerId: string,
  groupIds: string[],
  overrides: Partial<EnrollmentRow> = {},
): EnrollmentRow => ({
  learnerId,
  learnerName: `Learner ${learnerId}`,
  groupIds,
  courseId: 'payments',
  courseTitle: 'Taking card payments',
  status: 'not_started',
  score: null,
  activeSeconds: 0,
  attempts: 0,
  required: true,
  ...overrides,
});

const rows = [
  row('u-ada', ['g-voice'], { status: 'passed', score: 90, activeSeconds: 1_500, attempts: 1 }),
  row('u-ada', ['g-voice'], { courseId: 'returns', status: 'completed', activeSeconds: 2_100 }),
  row('u-bo', ['g-voice', 'g-chat'], {
    status: 'failed',
    score: 40,
    attempts: 2,
    dueDate: '2026-10-20',
  }),
  row('u-cy', ['g-chat'], { dueDate: '2026-11-30' }),
];
const groups = [
  { id: 'g-chat', name: 'Chat team' },
  { id: 'g-voice', name: 'Voice team' },
  { id: 'g-night', name: '=Night shift' },
];
const entries = teamView(rows, groups, '2026-10-27');

describe('teamViewCsv', () => {
  it('writes one line per group with counts, percent and averages', () => {
    expect(teamViewCsv(entries).split('\r\n')).toEqual([
      'Group,Learners,Enrollments,Not started,In progress,Completed,Passed,Failed,Overdue,' +
        'Completion %,Average score,Average time spent (minutes)',
      'Chat team,2,2,1,0,0,0,1,1,0,40,',
      'Voice team,2,3,0,0,1,1,1,1,67,65,30',
      "'=Night shift,0,0,0,0,0,0,0,0,0,,",
      '',
    ]);
  });

  it('can add a byte order mark', () => {
    expect(teamViewCsv([], { bom: true })).toBe(
      '\uFEFFGroup,Learners,Enrollments,Not started,In progress,Completed,Passed,Failed,' +
        'Overdue,Completion %,Average score,Average time spent (minutes)\r\n',
    );
  });
});

describe('team view schemas', () => {
  it('match teamView entries, over the wire', () => {
    const same: Same<z.infer<typeof TeamViewEntrySchema>, TeamViewEntry> = true;
    expect(same).toBe(true);
    const body = JSON.parse(JSON.stringify(entries));
    expect(TeamViewResponseSchema.parse(body)).toEqual(body);
    const tampered = [{ ...body[0], completionPercent: 150 }];
    expect(TeamViewResponseSchema.safeParse(tampered).success).toBe(false);
  });

  it('read the query: an optional course and CSV', () => {
    expect(TeamViewQuerySchema.parse({})).toEqual({});
    expect(TeamViewQuerySchema.parse({ courseId: 'payments', format: 'csv' })).toEqual({
      courseId: 'payments',
      format: 'csv',
    });
    expect(TeamViewQuerySchema.safeParse({ format: 'xlsx' }).success).toBe(false);
    expect(TeamViewQuerySchema.safeParse({ groupId: 'g-chat' }).success).toBe(false);
  });
});
