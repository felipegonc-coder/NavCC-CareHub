import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { QuizLessonSchema } from '../format/index';
import {
  CourseReportResponseSchema,
  CourseReportSchema,
  DropOffLessonSchema,
  EnrollmentRowSchema,
  OverdueEntrySchema,
  OverdueResponseSchema,
  QuestionAnalysisEntrySchema,
  ReportQuerySchema,
  ReportsOverviewResponseSchema,
  ReportsOverviewSchema,
  WrongPickSchema,
  courseReport,
  dropOff,
  overdueList,
  questionAnalysis,
  reportsOverview,
  type CourseReport,
  type DropOffLesson,
  type EnrollmentRow,
  type OverdueEntry,
  type QuestionAnalysisEntry,
  type ReportsOverview,
  type WrongPick,
} from './index';
import { daysOverdue } from './rows';

// The schemas describe the report types, both ways.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;
export type ReportsApiContract = [
  Expect<Same<z.infer<typeof EnrollmentRowSchema>, EnrollmentRow>>,
  Expect<Same<z.infer<typeof CourseReportSchema>, CourseReport>>,
  Expect<Same<z.infer<typeof ReportsOverviewSchema>, ReportsOverview>>,
  Expect<Same<z.infer<typeof OverdueEntrySchema>, OverdueEntry>>,
  Expect<Same<z.infer<typeof QuestionAnalysisEntrySchema>, QuestionAnalysisEntry>>,
  Expect<Same<z.infer<typeof WrongPickSchema>, WrongPick>>,
  Expect<Same<z.infer<typeof DropOffLessonSchema>, DropOffLesson>>,
];

// A fictional fire-safety course and its learners.
const today = '2030-03-12';
const course = {
  id: 'c-fire',
  title: 'Fire safety',
  lessons: [
    { id: 'l-exits', title: 'Exits and alarms' },
    { id: 'l-check', title: 'Fire safety check' },
    { id: 'l-survey', title: 'How did it go?' },
  ],
};
const row = (learnerId: string, learnerName: string, extra: Partial<EnrollmentRow>) => ({
  learnerId,
  learnerName,
  groupIds: ['g-north'],
  courseId: course.id,
  courseTitle: course.title,
  status: 'not_started' as const,
  score: null,
  activeSeconds: 0,
  attempts: 0,
  required: true,
  ...extra,
});
const rows: EnrollmentRow[] = [
  row('p-avery', 'Avery Quill', {
    status: 'passed',
    score: 90,
    activeSeconds: 1_260,
    attempts: 1,
    startedAt: '2030-03-09T09:00:00.000Z',
    completedAt: '2030-03-10T10:30:00.000Z',
    lastActivityAt: '2030-03-10T10:30:00.000Z',
  }),
  row('p-bram', 'Bram Okafor', {
    status: 'in_progress',
    activeSeconds: 300,
    startedAt: '2030-03-01T08:00:00.000Z',
    lastActivityAt: '2030-03-01T08:05:00.000Z',
    dueDate: '2030-03-05',
    lastLessonId: 'l-exits',
  }),
  row('p-cleo', 'Cleo Varga', { dueDate: '2030-03-20' }),
];

const quiz = QuizLessonSchema.parse({
  id: 'l-check',
  kind: 'quiz',
  title: 'Fire safety check',
  settings: {
    passMark: 80,
    maxAttempts: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
  },
  questions: [
    {
      id: 'q-first',
      type: 'single_choice',
      prompt: [{ runs: [{ text: 'What do you do first when the alarm sounds?' }] }],
      options: [
        { id: 'a', text: 'Raise the alarm and follow the plan', correct: true },
        { id: 'b', text: 'Finish the task at hand', correct: false },
      ],
    },
    {
      id: 'q-lift',
      type: 'true_false',
      prompt: [{ runs: [{ text: 'Use the lift to leave the building.' }] }],
      answer: false,
    },
  ],
});

describe('reports API schemas', () => {
  it('accept the overview as the report functions compute it', () => {
    const response = {
      today,
      overview: reportsOverview(rows, today),
      courses: [
        { courseId: course.id, courseTitle: course.title, report: courseReport(rows, today) },
      ],
    };
    expect(ReportsOverviewResponseSchema.parse(response)).toEqual(response);
  });

  it('accept a course report with question analysis, an empty survey and drop-off', () => {
    const attempts = [
      { results: [{ questionId: 'q-first', correct: false, picked: ['b'] }] },
      {
        results: [
          { questionId: 'q-first', correct: true, picked: ['a'] },
          { questionId: 'q-lift', correct: false, picked: ['true'] },
        ],
      },
    ];
    const questions = questionAnalysis(quiz, attempts);
    expect(questions.map((entry) => entry.wrongPicks.length)).toEqual([1, 1]);
    const response = {
      today,
      course: { id: course.id, title: course.title },
      report: courseReport(rows, today),
      learners: rows.map((learner) => ({ ...learner, daysOverdue: daysOverdue(learner, today) })),
      quizzes: [
        { lessonId: 'l-check', title: 'Fire safety check', mode: 'graded', questions },
        { lessonId: 'l-survey', title: 'How did it go?', mode: 'survey', questions: [] },
      ],
      dropOff: dropOff(course, rows),
    };
    expect(CourseReportResponseSchema.parse(response)).toEqual(response);
  });

  it('accept the overdue list', () => {
    const response = { today, entries: overdueList(rows, today) };
    expect(response.entries.map((entry) => entry.daysOverdue)).toEqual([7]);
    expect(OverdueResponseSchema.parse(response)).toEqual(response);
  });

  it('reject unknown fields and read only format=csv', () => {
    expect(ReportQuerySchema.parse({ format: 'csv' })).toEqual({ format: 'csv' });
    expect(ReportQuerySchema.parse({})).toEqual({});
    expect(ReportQuerySchema.safeParse({ format: 'xlsx' }).success).toBe(false);
    const report = { ...courseReport(rows, today), median: 3 };
    expect(CourseReportSchema.safeParse(report).success).toBe(false);
    const late = { ...overdueList(rows, today)[0], daysOverdue: 0 };
    expect(OverdueEntrySchema.safeParse(late).success).toBe(false);
  });
});
