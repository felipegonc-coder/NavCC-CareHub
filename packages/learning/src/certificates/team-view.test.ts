// The team view as CSV and over the wire: one line per group, then one per person.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { teamView, type EnrollmentRow, type TeamViewEntry } from '../reports/index';
import {
  TeamMemberSchema,
  TeamViewEntrySchema,
  TeamViewQuerySchema,
  TeamViewResponseSchema,
  teamMembers,
  teamViewCsv,
  type TeamMember,
  type TeamViewResponse,
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

describe('teamMembers', () => {
  it('gives one line per person: groups, courses, finished, overdue', () => {
    expect(teamMembers(rows, '2026-10-27')).toEqual([
      {
        id: 'u-ada',
        name: 'Learner u-ada',
        groupIds: ['g-voice'],
        courses: 2,
        finished: 2,
        overdue: 0,
        lastActivityAt: null,
      },
      {
        id: 'u-bo',
        name: 'Learner u-bo',
        groupIds: ['g-voice', 'g-chat'],
        courses: 1,
        finished: 0,
        overdue: 1,
        lastActivityAt: null,
      },
      {
        id: 'u-cy',
        name: 'Learner u-cy',
        groupIds: ['g-chat'],
        courses: 1,
        finished: 0,
        overdue: 0,
        lastActivityAt: null,
      },
    ]);
    expect(teamMembers([], '2026-10-27')).toEqual([]);
  });

  it('takes the latest start, activity or completion and sorts by name, then id', () => {
    const people = teamMembers(
      [
        row('u-2', ['g-chat'], {
          learnerName: 'zoë',
          startedAt: '2026-10-01T09:00:00Z',
          lastActivityAt: '2026-10-03T09:00:00Z',
        }),
        row('u-2', ['g-voice', 'g-chat'], {
          learnerName: 'zoë',
          courseId: 'returns',
          status: 'passed',
          completedAt: '2026-10-05T10:00:00+02:00',
        }),
        row('u-1', [], { learnerName: 'Zoe', startedAt: '2026-10-02T09:00:00Z' }),
        row('u-10', [], { learnerName: 'Ann 10' }),
        row('u-9', [], { learnerName: 'Ann 9' }),
      ],
      '2026-10-27',
    );
    expect(people.map((person) => person.id)).toEqual(['u-9', 'u-10', 'u-1', 'u-2']);
    expect(people[3]).toEqual({
      id: 'u-2',
      name: 'zoë',
      groupIds: ['g-chat', 'g-voice'],
      courses: 2,
      finished: 1,
      overdue: 0,
      lastActivityAt: '2026-10-05T10:00:00+02:00',
    });
    expect(people[2]?.lastActivityAt).toBe('2026-10-02T09:00:00Z');
  });
});

describe('team view schemas', () => {
  it('match teamView entries and teamMembers, over the wire', () => {
    const sameEntry: Same<z.infer<typeof TeamViewEntrySchema>, TeamViewEntry> = true;
    const sameMember: Same<z.infer<typeof TeamMemberSchema>, TeamMember> = true;
    expect([sameEntry, sameMember]).toEqual([true, true]);
    const response: TeamViewResponse = {
      courses: [
        { id: 'returns', title: 'Handling returns' },
        { id: 'payments', title: 'Taking card payments' },
      ],
      groups: entries,
      people: teamMembers(rows, '2026-10-27'),
    };
    const body = JSON.parse(JSON.stringify(response));
    expect(TeamViewResponseSchema.parse(body)).toEqual(body);
    const tampered = { ...body, groups: [{ ...body.groups[0], completionPercent: 150 }] };
    expect(TeamViewResponseSchema.safeParse(tampered).success).toBe(false);
    const negative = { ...body, people: [{ ...body.people[0], overdue: -1 }] };
    expect(TeamViewResponseSchema.safeParse(negative).success).toBe(false);
    expect(TeamViewResponseSchema.safeParse(body.groups).success).toBe(false);
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
