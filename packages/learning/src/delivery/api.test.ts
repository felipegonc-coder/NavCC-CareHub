import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_LIMITS,
  AssignmentSchema,
  CreateAssignmentsRequestSchema,
  DUE_STATUSES,
  MyLearningEntrySchema,
  MyLearningResponseSchema,
} from './index';

const tara = '00000000-0000-4000-8000-00000000000a';
const omar = '00000000-0000-4000-8000-00000000000b';
const course = { type: 'course', id: 'safe-lifting' } as const;

const issues = (input: unknown) => {
  const result = CreateAssignmentsRequestSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
};

describe('CreateAssignmentsRequestSchema', () => {
  it('fills in no groups, no people and required, and keeps a due date or a number of days', () => {
    expect(CreateAssignmentsRequestSchema.parse({ target: course, people: [tara] })).toEqual({
      target: course,
      people: [tara],
      groups: [],
      required: true,
    });
    const byGroup = { target: { type: 'path', id: 'new-starters' }, groups: ['night-shift'] };
    expect(
      CreateAssignmentsRequestSchema.parse({ ...byGroup, dueInDays: 14, required: false }),
    ).toEqual({ ...byGroup, people: [], dueInDays: 14, required: false });
    expect(
      CreateAssignmentsRequestSchema.parse({
        target: course,
        people: [omar],
        dueDate: '2026-11-30',
      }).dueDate,
    ).toBe('2026-11-30');
  });

  it('asks for someone to assign, and for a due date or a number of days, not both', () => {
    expect(issues({ target: course })).toEqual([
      ['people', 'Choose at least one person or group.'],
    ]);
    expect(issues({ target: course, people: [tara], dueDate: '2026-11-30', dueInDays: 7 })).toEqual(
      [['dueInDays', 'Give a due date or a number of days, not both.']],
    );
  });

  it('refuses people who are not user ids, bad targets, days and dates, and unknown fields', () => {
    expect(issues({ target: course, people: ['tara'] })).toEqual([
      ['people.0', 'Choose people from the workspace.'],
    ]);
    for (const bad of [
      { target: { type: 'page', id: 'x' }, people: [tara] },
      { target: { type: 'course', id: 'has spaces' }, people: [tara] },
      { target: course, people: [tara], dueInDays: 0 },
      { target: course, people: [tara], dueInDays: ASSIGNMENT_LIMITS.dueInDays + 1 },
      { target: course, people: [tara], dueInDays: 1.5 },
      { target: course, people: [tara], dueDate: '2026-02-30' },
      { target: course, people: [tara], dueDate: '30/11/2026' },
      { target: course, people: [tara], everyone: true },
      { target: course, groups: ['<script>'] },
    ]) {
      const ok = CreateAssignmentsRequestSchema.safeParse(bad).success;
      expect({ bad, ok }).toEqual({ bad, ok: false });
    }
    const crowd = Array.from({ length: ASSIGNMENT_LIMITS.people + 1 }, () => tara);
    expect(
      CreateAssignmentsRequestSchema.safeParse({ target: course, people: crowd }).success,
    ).toBe(false);
  });
});

describe('response schemas', () => {
  const entry = {
    courseId: 'safe-lifting',
    title: 'Safe lifting (fictional)',
    status: 'in_progress',
    progressPercent: 40,
    assigned: true,
    required: true,
    dueDate: '2026-11-30',
    dueStatus: 'upcoming',
    lastActivityAt: '2026-10-27T15:00:00.000Z',
    completedAt: null,
    href: '/learning/courses/safe-lifting',
  };

  it('reads an assignment and a My learning page', () => {
    const assignment = {
      id: '00000000-0000-4000-8000-000000000101',
      courseId: 'safe-lifting',
      courseTitle: 'Safe lifting (fictional)',
      pathId: null,
      people: [tara],
      groups: ['night-shift'],
      dueDate: null,
      dueInDays: 14,
      required: true,
      createdBy: omar,
      createdAt: '2026-10-27T15:00:00.000Z',
    };
    expect(AssignmentSchema.parse(assignment)).toEqual(assignment);
    const page = { continue: [entry], assigned: [], overdue: [], finished: [] };
    expect(MyLearningResponseSchema.parse(page)).toEqual(page);
  });

  it('keeps every link inside Learning and every percentage whole', () => {
    for (const href of [
      'https://example.test/x',
      '//example.test',
      'javascript:alert(1)',
      '/p/1',
    ]) {
      expect({ href, ok: MyLearningEntrySchema.safeParse({ ...entry, href }).success }).toEqual({
        href,
        ok: false,
      });
    }
    expect(MyLearningEntrySchema.safeParse({ ...entry, progressPercent: 40.5 }).success).toBe(
      false,
    );
    expect(DUE_STATUSES).toContain(entry.dueStatus);
  });
});
