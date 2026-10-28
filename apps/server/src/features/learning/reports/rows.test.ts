import type { LearnerAssignment } from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import type { CourseStateRow } from '../progress/service';
import { rowsOf } from './rows';

// Report rows from plain data. Fictional people and courses only.
const ADA = '0b6e3c1a-4d1f-4f0e-9a51-6f1d2c3b4a01';
const BO = '0b6e3c1a-4d1f-4f0e-9a51-6f1d2c3b4a02';

const assignment = (more: Partial<LearnerAssignment> = {}): LearnerAssignment => ({
  learnerId: ADA,
  courseId: 'calls-with-care',
  required: true,
  assignmentId: 'a-1',
  assignmentIds: ['a-1'],
  ...more,
});

const state = (more: Partial<CourseStateRow> = {}): CourseStateRow => ({
  userId: ADA,
  courseId: 'calls-with-care',
  status: 'in_progress',
  percentComplete: 40,
  startedAt: '2026-10-20T15:00:00.000Z',
  completedAt: null,
  lastActivityAt: '2026-10-21T16:30:00.000Z',
  score: null,
  activeSeconds: 600,
  attempts: 0,
  lastLessonId: 'lesson-2',
  previousFinishedAt: null,
  ...more,
});

const titles = new Map([
  ['calls-with-care', 'Handling calls with care'],
  ['privacy-basics', 'Privacy basics'],
]);
const names = new Map([
  [ADA, 'Ada Example'],
  [BO, 'Bo Sample'],
]);

describe('rowsOf', () => {
  it('joins an assignment and its progress into one row', () => {
    const rows = rowsOf({
      assignments: [assignment({ dueDate: '2026-10-30' })],
      states: [state()],
      titles,
      names,
      groups: [{ id: 'g-night', name: 'Night shift', memberIds: [ADA] }],
    });
    expect(rows).toEqual([
      {
        learnerId: ADA,
        learnerName: 'Ada Example',
        groupIds: ['g-night'],
        courseId: 'calls-with-care',
        courseTitle: 'Handling calls with care',
        status: 'in_progress',
        score: null,
        activeSeconds: 600,
        attempts: 0,
        startedAt: '2026-10-20T15:00:00.000Z',
        lastActivityAt: '2026-10-21T16:30:00.000Z',
        dueDate: '2026-10-30',
        lastLessonId: 'lesson-2',
        required: true,
      },
    ]);
  });

  it('counts an assigned course not started yet, and a started course nobody assigned', () => {
    const rows = rowsOf({
      assignments: [assignment({ learnerId: BO, courseId: 'privacy-basics', required: false })],
      states: [
        state({
          status: 'passed',
          completedAt: '2026-10-22T17:00:00.000Z',
          score: 90,
          attempts: 2,
          lastLessonId: null,
        }),
      ],
      titles,
      names,
      groups: [],
    });
    expect(rows.map((row) => [row.learnerName, row.courseId, row.status, row.required])).toEqual([
      ['Bo Sample', 'privacy-basics', 'not_started', false],
      ['Ada Example', 'calls-with-care', 'passed', false],
    ]);
    expect(rows[0]).toEqual({
      learnerId: BO,
      learnerName: 'Bo Sample',
      groupIds: [],
      courseId: 'privacy-basics',
      courseTitle: 'Privacy basics',
      status: 'not_started',
      score: null,
      activeSeconds: 0,
      attempts: 0,
      required: false,
    });
    expect(rows[1]).toMatchObject({
      score: 90,
      attempts: 2,
      completedAt: '2026-10-22T17:00:00.000Z',
    });
    expect(rows[1]).not.toHaveProperty('lastLessonId');
    expect(rows[1]).not.toHaveProperty('dueDate');
  });

  it('leaves out courses without a live title, and names nobody it does not know', () => {
    const rows = rowsOf({
      assignments: [assignment({ courseId: 'gone' })],
      states: [state({ userId: '0b6e3c1a-4d1f-4f0e-9a51-6f1d2c3b4a99' })],
      titles,
      names,
      groups: [],
    });
    expect(rows.map((row) => [row.courseId, row.learnerName])).toEqual([['calls-with-care', '']]);
  });
});
