import {
  CourseReportResponseSchema,
  OverdueResponseSchema,
  ReportsOverviewResponseSchema,
  richText,
  sampleStandardCourse,
  type Course,
  type EnrollmentRow,
  type QuizLesson,
} from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import type { LearningPermission, Viewer } from '../auth';
import type { AnsweredQuestion, QuizAnswers } from '../progress/answers';
import {
  courseReportCsvOf,
  courseReportOf,
  overdueCsvOf,
  overdueOf,
  reportsOverviewCsvOf,
  reportsOverviewOf,
  type CourseReportSources,
} from './course-reports';
import type { RowsQuery } from './rows';

// The reports overview, the course report and the overdue list on plain data. Fictional people
// and courses only: the standard sample course with a one-question survey after its final quiz,
// and a second course that only has rows. 18:00 UTC on 10 March 2026 is 10 March in the Learning
// day zone.
const NOW = new Date('2026-03-10T18:00:00Z');
const TODAY = '2026-03-10';
const WORKSPACE = 'workspace-brightside';
const [ADA, BEN, CY, DEE] = ['person-ada', 'person-ben', 'person-cy', 'person-dee'];
const [ANALYST, ANALYST_NO_ZONE, MANAGER, OUTSIDER] = [
  'person-ana',
  'person-al',
  'person-mo',
  'person-oz',
];

const survey: QuizLesson = {
  id: 'calls-survey',
  kind: 'quiz',
  title: 'Tell us what you think',
  settings: {
    passMark: 0,
    maxAttempts: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    revealAnswers: 'never',
    mode: 'survey',
  },
  questions: [
    {
      id: 'survey-useful',
      type: 'single_choice',
      prompt: richText('How useful was this course?'),
      points: 1,
      options: [
        { id: 'very', text: 'Very useful', correct: false },
        { id: 'not', text: 'Not useful', correct: false },
      ],
    },
  ],
};
const CALLS: Course = {
  ...sampleStandardCourse,
  lessons: [...sampleStandardCourse.lessons, survey],
};
const EMAIL = { courseId: 'course-email-basics', courseTitle: 'Answering email' };

const row = (learnerId: string, learnerName: string, more: Partial<EnrollmentRow>) => ({
  learnerId,
  learnerName,
  groupIds: [],
  courseId: CALLS.id,
  courseTitle: CALLS.title,
  status: 'not_started' as const,
  score: null,
  activeSeconds: 0,
  attempts: 0,
  required: true,
  ...more,
});

const ROWS: EnrollmentRow[] = [
  row(CY, 'Cy Test', { dueDate: '2026-03-09' }),
  row(BEN, 'Ben Sample', {
    status: 'in_progress',
    score: 40,
    activeSeconds: 300,
    attempts: 1,
    startedAt: '2026-03-02T16:00:00Z',
    lastActivityAt: '2026-03-04T16:00:00Z',
    lastLessonId: 'calls-during',
    dueDate: '2026-03-07',
  }),
  row(ADA, 'Ada Example', {
    status: 'passed',
    score: 80,
    activeSeconds: 1200,
    attempts: 1,
    startedAt: '2026-03-09T15:00:00Z',
    completedAt: '2026-03-10T04:30:00Z',
    lastActivityAt: '2026-03-10T04:30:00Z',
    dueDate: '2026-03-20',
  }),
  row(ADA, 'Ada Example', {
    ...EMAIL,
    status: 'completed',
    activeSeconds: 600,
    attempts: 1,
    startedAt: '2026-02-20T16:00:00Z',
    completedAt: '2026-02-21T16:00:00Z',
    required: false,
  }),
  row(DEE, 'Dee Person', {
    ...EMAIL,
    status: 'in_progress',
    activeSeconds: 120,
    attempts: 1,
    startedAt: '2026-02-25T16:00:00Z',
    lastActivityAt: '2026-02-25T16:00:00Z',
    dueDate: '2026-03-01',
  }),
];

const result = (questionId: string, picked: string[], correct: boolean): AnsweredQuestion => ({
  questionId,
  answered: true,
  correct,
  earned: correct ? 1 : 0,
  max: 1,
  fraction: correct ? 1 : 0,
  picked,
});
const answers = (
  learnerId: string,
  lessonId: string,
  mode: QuizAnswers['mode'],
  results: AnsweredQuestion[],
): QuizAnswers => ({
  learnerId,
  lessonId,
  mode,
  version: 1,
  attempts: [
    { attemptId: `${learnerId}-${lessonId}`, submittedAt: '2026-03-09T16:00:00Z', results },
  ],
});
const ANSWERS: QuizAnswers[] = [
  answers(ADA, 'calls-quiz', 'graded', [result('calls-q-first', ['record'], true)]),
  answers(BEN, 'calls-quiz', 'graded', [result('calls-q-first', ['email'], false)]),
  answers(ADA, 'calls-survey', 'survey', [result('survey-useful', ['very'], false)]),
];

/** Plain-data sources: the rows above, CALLS as the only live course, Ben and Dee report to Mo. */
function plainSources(): CourseReportSources & { queries: RowsQuery[] } {
  const queries: RowsQuery[] = [];
  return {
    queries,
    async rows(query) {
      queries.push(query);
      return ROWS.filter(
        (one) =>
          (query.userIds === undefined || query.userIds.includes(one.learnerId)) &&
          (query.courseIds === undefined || query.courseIds.includes(one.courseId)),
      );
    },
    liveCourse: async (_workspaceId, courseId) => (courseId === CALLS.id ? CALLS : null),
    quizAnswers: async () => ANSWERS,
    reportsOf: async (_workspaceId, managerId) => (managerId === MANAGER ? [BEN, DEE] : []),
    timeZone: async (userId) => (userId === ANALYST ? 'Europe/Berlin' : null),
  };
}

const viewer = (userId: string, ...permissions: LearningPermission[]): Viewer => ({
  userId,
  workspaceId: WORKSPACE,
  can: (permission) => permissions.includes(permission),
});
const analyst = viewer(ANALYST, 'learning.analytics');
const manager = viewer(MANAGER, 'learning.build');
const outsider = viewer(OUTSIDER, 'learning.build', 'learning.assign');

/** The status a call fails with (200 when it doesn't), and its message. */
const failureOf = (call: Promise<unknown>) =>
  call.then(
    () => ({ status: 200, message: '' }),
    (error: { status: number; message: string }) => ({
      status: error.status,
      message: error.message,
    }),
  );

describe('reportsOverviewOf', () => {
  it('sums up every live course, then one line per course by title', async () => {
    const sources = plainSources();
    const response = await reportsOverviewOf(sources, analyst, NOW);
    expect(ReportsOverviewResponseSchema.safeParse(response).success).toBe(true);
    expect(sources.queries).toEqual([{ workspaceId: WORKSPACE, today: TODAY }]);
    expect(response.today).toBe(TODAY);
    // Ben and Ada were active from 4 to 10 March; Ada's pass on the 10th at 04:30 UTC is still
    // the 9th in the Learning day zone, so it counts this week.
    expect(response.overview).toEqual({
      learners: 4,
      activeLearners: 2,
      completions: 2,
      completionsThisWeek: 1,
      passRate: 100,
      overdue: 3,
    });
    expect(response.courses).toEqual([
      {
        courseId: EMAIL.courseId,
        courseTitle: 'Answering email',
        report: {
          total: 2,
          notStarted: 0,
          inProgress: 1,
          completed: 1,
          passed: 0,
          failed: 0,
          overdue: 1,
          completionPercent: 50,
          averageScore: null,
          averageActiveSeconds: 600,
        },
      },
      {
        courseId: CALLS.id,
        courseTitle: 'Handling calls with care',
        report: {
          total: 3,
          notStarted: 1,
          inProgress: 1,
          completed: 0,
          passed: 1,
          failed: 0,
          overdue: 2,
          completionPercent: 33,
          averageScore: 60,
          averageActiveSeconds: 1200,
        },
      },
    ]);
  });

  it("gives managers their own people's rows and turns down everyone else", async () => {
    const sources = plainSources();
    const response = await reportsOverviewOf(sources, manager, NOW);
    expect(sources.queries).toEqual([
      { workspaceId: WORKSPACE, today: TODAY, userIds: [BEN, DEE] },
    ]);
    expect(response.overview.learners).toBe(2);
    expect(response.courses.map((course) => [course.courseTitle, course.report.total])).toEqual([
      ['Answering email', 1],
      ['Handling calls with care', 1],
    ]);
    expect(await failureOf(reportsOverviewOf(sources, outsider, NOW))).toMatchObject({
      status: 403,
    });
    expect(await failureOf(overdueOf(sources, outsider, NOW))).toMatchObject({ status: 403 });
  });
});

describe('courseReportOf', () => {
  it('reports on the live course: learners by name, quizzes and where people stopped', async () => {
    const sources = plainSources();
    const response = await courseReportOf(sources, analyst, CALLS.id, NOW);
    expect(CourseReportResponseSchema.safeParse(response).success).toBe(true);
    expect(sources.queries).toEqual([
      { workspaceId: WORKSPACE, today: TODAY, courseIds: [CALLS.id] },
    ]);
    expect(response.course).toEqual({ id: CALLS.id, title: 'Handling calls with care' });
    expect(response.report).toMatchObject({ total: 3, passed: 1, overdue: 2, averageScore: 60 });
    expect(response.learners.map((learner) => [learner.learnerName, learner.daysOverdue])).toEqual([
      ['Ada Example', null],
      ['Ben Sample', 3],
      ['Cy Test', 1],
    ]);

    const [quiz, feedback] = response.quizzes;
    expect(response.quizzes).toHaveLength(2);
    expect(quiz).toMatchObject({ lessonId: 'calls-quiz', title: 'Final quiz', mode: 'graded' });
    expect(quiz?.questions[0]).toEqual({
      questionId: 'calls-q-first',
      type: 'single_choice',
      prompt: 'What do you open before taking a call?',
      answered: 2,
      correct: 1,
      percentCorrect: 50,
      wrongPicks: [{ id: 'email', text: 'Your email', count: 1 }],
    });
    expect(quiz?.questions.slice(1).map((question) => question.answered)).toEqual([0, 0, 0, 0]);
    // A survey has no right answers: its answers are in the survey results, not here.
    expect(feedback).toEqual({
      lessonId: 'calls-survey',
      title: 'Tell us what you think',
      mode: 'survey',
      questions: [],
    });

    expect(
      response.dropOff.map((lesson) => [lesson.lessonId, lesson.stopped, lesson.percent]),
    ).toEqual([
      ['calls-before', 0, 0],
      ['calls-during', 1, 50],
      ['calls-after', 0, 0],
      ['calls-quiz', 0, 0],
      ['calls-survey', 0, 0],
    ]);
  });

  it("counts only a manager's own people, answers included", async () => {
    const response = await courseReportOf(plainSources(), manager, CALLS.id, NOW);
    expect(response.learners.map((learner) => learner.learnerId)).toEqual([BEN]);
    expect(response.quizzes[0]?.questions[0]).toMatchObject({
      questionId: 'calls-q-first',
      answered: 1,
      correct: 0,
      percentCorrect: 0,
    });
  });

  it('answers 404 for a course without a live version, after the permission check', async () => {
    const sources = plainSources();
    const notLive = {
      status: 404,
      message: "This course isn't published, so it has no report yet.",
    };
    expect(await failureOf(courseReportOf(sources, analyst, 'course-draft', NOW))).toEqual(notLive);
    expect(await failureOf(courseReportCsvOf(sources, analyst, 'course-draft', NOW))).toEqual(
      notLive,
    );
    expect(await failureOf(courseReportOf(sources, outsider, 'course-draft', NOW))).toMatchObject({
      status: 403,
    });
    expect(sources.queries).toEqual([]);
  });
});

describe('overdueOf', () => {
  it('lists who is late on what, most late first', async () => {
    const response = await overdueOf(plainSources(), analyst, NOW);
    expect(OverdueResponseSchema.safeParse(response).success).toBe(true);
    expect(response.today).toBe(TODAY);
    expect(
      response.entries.map((entry) => [entry.learnerName, entry.courseTitle, entry.daysOverdue]),
    ).toEqual([
      ['Dee Person', 'Answering email', 9],
      ['Ben Sample', 'Handling calls with care', 3],
      ['Cy Test', 'Handling calls with care', 1],
    ]);
  });
});

describe('report CSV files', () => {
  it('names each file after the report and today, with a byte order mark for Excel', async () => {
    const sources = plainSources();
    expect(await reportsOverviewCsvOf(sources, analyst, NOW)).toEqual({
      filename: 'learning-overview-2026-03-10.csv',
      text:
        '\uFEFFCourse,Learners,Not started,In progress,Completed,Passed,Failed,Overdue,' +
        'Completion %,Average score,Average time spent (minutes)\r\n' +
        'Answering email,2,0,1,1,0,0,1,50,,10\r\n' +
        'Handling calls with care,3,1,1,0,1,0,2,33,60,20\r\n',
    });
    expect(await overdueCsvOf(sources, analyst, NOW)).toEqual({
      filename: 'overdue-learning-2026-03-10.csv',
      text:
        '\uFEFFName,Course,Status,Due,Days overdue\r\n' +
        'Dee Person,Answering email,In progress,2026-03-01,9\r\n' +
        'Ben Sample,Handling calls with care,In progress,2026-03-07,3\r\n' +
        'Cy Test,Handling calls with care,Not started,2026-03-09,1\r\n',
    });
  });

  it("writes the course report's days in the viewer's profile zone", async () => {
    const sources = plainSources();
    const header =
      '\uFEFFName,Status,Score,Time spent (minutes),Attempts,Started,Completed,Due,' +
      'Days overdue\r\n';
    const berlin = await courseReportCsvOf(sources, analyst, CALLS.id, NOW);
    expect(berlin).toEqual({
      filename: 'course-report-course-calls-with-care-2026-03-10.csv',
      text:
        header +
        'Ada Example,Passed,80,20,1,2026-03-09,2026-03-10,2026-03-20,\r\n' +
        'Ben Sample,In progress,40,5,1,2026-03-02,,2026-03-07,3\r\n' +
        'Cy Test,Not started,,0,0,,,2026-03-09,1\r\n',
    });
    // Without a profile zone, days are in the Learning day zone: Ada finished on the 9th there.
    const denver = await courseReportCsvOf(
      sources,
      viewer(ANALYST_NO_ZONE, 'learning.analytics'),
      CALLS.id,
      NOW,
    );
    expect(denver.text.split('\r\n')[1]).toBe(
      'Ada Example,Passed,80,20,1,2026-03-09,2026-03-09,2026-03-20,',
    );
  });
});
