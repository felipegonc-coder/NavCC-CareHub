// Learning acceptance checks: reports. From the Learning PRD (section 4.3, and section 7, Phase 1
// and Phase 2 "Finished when") and the Learning Phase 1 test checklist (sections 3 and 4). Learning
// has no "Done means" list yet, so the IDs are the Testing lane's (LN-xx). CSV columns and report
// numbers: packages/learning/src/reports (csv.ts, course-report.ts, question-analysis.ts).
import type { APIResponse } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { assign, day, setDueDate, whoIs } from './assign-data.js';
import {
  REMY,
  TARA,
  choice,
  content,
  liveCourse,
  pageFor,
  quiz,
  trueFalse,
} from './course-data.js';
import { NO_ACCESS, shownDayIn } from './learner-page.js';
import { PlayerPage } from './player-page.js';
import { ReportsPage, courseReport } from './reports-page.js';

// The browser is in Tokyo: Learning shows days in the profile's time zone (decision 0317).
test.use({ timezoneId: 'Asia/Tokyo' });

const GREET = 'You greet the caller first.';
const HOLD = 'What do you do during a long hold?';
/** One quiz that half the answers pass. */
const quizCourse = () => [
  quiz(
    'l1',
    'Fictional QA final quiz',
    [trueFalse('q1', GREET, true), choice('q2', HOLD, ['Check in often'], ['Hang up'])],
    { passMark: 50 },
  ),
];
const twoLessons = () => [
  content('l1', 'Fictional QA lesson one'),
  content('l2', 'Fictional QA lesson two'),
];
/** A time spent, the way a report could show it: "4 min", "45 s", "0:45". */
const TIME = /\d+\s*(s|sec|secs|m|min|mins|minutes?)\b|\d+:\d\d/i;
/** The CSV's columns (packages/learning/src/reports/csv.ts). */
const COLUMNS = [
  ...['Name', 'Status', 'Score', 'Time spent (minutes)', 'Attempts'],
  ...['Started', 'Completed', 'Due', 'Days overdue'],
];
const messageOf = async (response: APIResponse) =>
  ((await response.json()) as { error: { message: string } }).error.message;

/** The learner takes the quiz: the greeting right, the hold question right or wrong. */
async function takeQuiz(learner: PlayerPage, courseId: string, holdRight = true) {
  await learner.start(courseId);
  await learner.startQuiz();
  await learner.answerTrueFalse(GREET, true);
  const hold = learner.main.getByRole('group', { name: HOLD });
  await hold.getByRole('radio', { name: holdRight ? 'Check in often' : 'Hang up' }).check();
  await learner.submit();
  await expect(learner.score(holdRight ? 100 : 50)).toBeVisible();
}

/** The learner finishes lesson one of two and stops. */
async function stopAfterLessonOne(learner: PlayerPage, courseId: string) {
  await learner.start(courseId);
  await learner.next();
  await expect(learner.lessonHeading('Fictional QA lesson two')).toBeVisible();
}

test.describe('Learning: reports', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningReports');

  test('LN-09 within a minute of a learner finishing, the course report shows result, score and time', async ({
    browser,
    page,
  }) => {
    needs('learningQuizzes');
    test.setTimeout(120_000);
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const me = await whoIs(eli.page);
    const course = await test.step('Tara assigns Eli a quiz course', async () => {
      await signInAs(page, TARA);
      const course = await liveCourse(page, quizCourse());
      await assign(page, course.id, { people: [me.id] });
      return course;
    });
    await test.step('Eli passes with every answer right', () => takeQuiz(eli, course.id));
    await test.step('Learning → Reports → the course: Eli passed, with score and time', async () => {
      const reports = new ReportsPage(page);
      await reports.openCourse(course.title);
      await reports.expectRowSoon(me.name, /passed|completed/i);
      await expect(reports.row(me.name)).toContainText('100');
      await expect(reports.row(me.name)).toContainText(TIME);
    });
  });

  test('LN-10 Download CSV has names, status, score and time, and people not started too', async ({
    browser,
    page,
  }) => {
    needs('learningQuizzes');
    test.setTimeout(120_000);
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const me = await whoIs(eli.page);
    const casey = await whoIs(await pageFor(browser, 'commenter'));
    const course = await test.step('Tara assigns a quiz course to Eli and Casey', async () => {
      await signInAs(page, TARA);
      const course = await liveCourse(page, quizCourse());
      await assign(page, course.id, { people: [me.id, casey.id] });
      return course;
    });
    await test.step('Eli passes; Casey has not started', () => takeQuiz(eli, course.id));
    await test.step('the CSV lists both in tidy columns', async () => {
      const reports = new ReportsPage(page);
      await reports.openCourse(course.title);
      await reports.expectRowSoon(me.name, /passed/i);
      const [header, ...lines] = await reports.downloadCsv();
      expect(header).toEqual(COLUMNS);
      const line = (name: string) => lines.find((cells) => cells[0] === name) ?? [];
      expect(line(me.name).slice(1, 3)).toEqual(['Passed', '100']);
      expect(line(me.name)[3], 'whole minutes').toMatch(/^\d+$/);
      expect(line(casey.name).slice(1, 3)).toEqual(['Not started', '']);
    });
  });

  test('LN-12 Reset next to a learner makes them start from the beginning next time', async ({
    browser,
    page,
  }) => {
    test.setTimeout(120_000);
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const me = await whoIs(eli.page);
    const course = await test.step('Tara assigns Eli a course with two lessons', async () => {
      await signInAs(page, TARA);
      const course = await liveCourse(page, twoLessons());
      await assign(page, course.id, { people: [me.id] });
      return course;
    });
    await test.step('Eli finishes lesson one and stops', () => stopAfterLessonOne(eli, course.id));
    await test.step('Tara clicks Reset next to Eli in the course report', async () => {
      const reports = new ReportsPage(page);
      await reports.openCourse(course.title);
      await reports.expectRowSoon(me.name, /in progress/i);
      await reports.reset(me.name);
    });
    await test.step('next time, Eli starts from lesson one', async () => {
      expect((await eli.progress(course.id)).status).toBe('not_started');
      await eli.page.goto(`/learning/courses/${course.id}`);
      await expect(eli.main.getByRole('link', { name: 'Start course' })).toBeVisible();
      const carryOn = /^(resume|continue)/i;
      const resume = eli.main.getByRole('link', { name: carryOn });
      await expect(resume.or(eli.main.getByRole('button', { name: carryOn }))).toHaveCount(0);
      await eli.start(course.id);
      await expect(eli.lessonHeading('Fictional QA lesson one')).toBeVisible();
    });
  });

  test('LN-11 a report viewer sees the report, with no Studio and no Reset', async ({
    browser,
    page,
  }) => {
    needs('learningStudio');
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const me = await whoIs(eli.page);
    const course =
      await test.step('Tara assigns Eli a course; he finishes lesson one', async () => {
        await signInAs(page, TARA);
        const course = await liveCourse(page, twoLessons());
        await assign(page, course.id, { people: [me.id] });
        await stopAfterLessonOne(eli, course.id);
        return course;
      });
    const remy = new ReportsPage(await pageFor(browser, REMY));
    await test.step('Remy has Reports and no Studio; the report has Eli and no Reset', async () => {
      await remy.page.goto('/learning');
      await expect(remy.page.getByRole('link', { name: 'Reports' })).toBeVisible();
      await expect(remy.page.getByRole('link', { name: 'Studio' })).toHaveCount(0);
      await remy.openCourse(course.title);
      await remy.expectRowSoon(me.name, /in progress/i);
      await expect(remy.main.getByRole('button', { name: /^reset/i })).toHaveCount(0);
    });
    await test.step('a Studio link says Remy has no access, and never shows the editor', async () => {
      await remy.page.goto(`/learning/studio/courses/${course.id}`);
      await expect(remy.page.getByText(NO_ACCESS)).toBeVisible();
      await expect(remy.page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
      await expect(remy.page.getByText(course.title)).toHaveCount(0);
    });
    await test.step('the server refuses Remy the course in Studio and Reset (403)', async () => {
      const api = await apiFor(remy.page);
      const reset = `/api/learning/people/${me.id}/courses/${course.id}/reset`;
      const studio = `/api/learning/studio/courses/${course.id}`;
      expect((await api.send('POST', reset, {})).status(), reset).toBe(403);
      expect((await api.send('GET', studio)).status(), studio).toBe(403);
      expect((await eli.progress(course.id)).status, "Eli's progress").toBe('in_progress');
    });
  });

  test('LN-13 a learner has no Studio or Reports, and a report link shows no names or scores', async ({
    browser,
    page,
  }) => {
    const casey = await whoIs(await pageFor(browser, 'commenter'));
    const course = await test.step('Tara assigns Casey a course', async () => {
      await signInAs(page, TARA);
      const course = await liveCourse(page, quizCourse());
      await assign(page, course.id, { people: [casey.id] });
      return course;
    });
    const eliPage = await pageFor(browser, 'editor');
    await test.step('Learning has no Studio or Reports tab for Eli', async () => {
      await eliPage.goto('/learning');
      await expect(eliPage.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(eliPage.getByRole('link', { name: 'Studio' })).toHaveCount(0);
      await expect(eliPage.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    });
    await test.step('the report link says he has no access, with no names', async () => {
      await eliPage.goto(`/learning/reports/courses/${course.id}`);
      await expect(eliPage.getByText(NO_ACCESS)).toBeVisible();
      await expect(eliPage.getByText(casey.name)).toHaveCount(0);
    });
    await test.step('the server refuses the report, its CSV and the overview with 403', async () => {
      const api = await apiFor(eliPage);
      const report = `/api/learning/reports/courses/${course.id}`;
      for (const path of [report, `${report}?format=csv`, '/api/learning/reports/overview']) {
        expect((await api.send('GET', path)).status(), path).toBe(403);
      }
      expect(await messageOf(await api.send('GET', report))).toBe("You don't have access to this.");
    });
  });

  // Due today, nobody is overdue yet; the next check moves the due date into the past.
  test('LN-22 the course report counts passed, in progress and not started, and names the most-missed question', async ({
    browser,
    page,
  }) => {
    needs('learningQuizzes');
    test.setTimeout(120_000);
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const casey = new PlayerPage(await pageFor(browser, 'commenter'));
    const val = await whoIs(await pageFor(browser, 'viewer'));
    const [eliMe, caseyMe] = [await whoIs(eli.page), await whoIs(casey.page)];
    const course =
      await test.step('Tara assigns a quiz course to Eli, Casey and Val, due today', async () => {
        await signInAs(page, TARA);
        const course = await liveCourse(page, quizCourse());
        await assign(page, course.id, { people: [eliMe.id, caseyMe.id, val.id], dueDate: day() });
        return course;
      });
    await test.step('Eli passes with the hold question wrong; Casey starts; Val does not', async () => {
      await takeQuiz(eli, course.id, false);
      await casey.start(course.id);
      await casey.startQuiz();
    });
    await test.step('within a minute the report has 1 passed, 1 in progress, 1 not started: 33%', async () => {
      const report = { total: 3, passed: 1, inProgress: 1, notStarted: 1, overdue: 0 };
      // Most missed first: the hold question, nobody right, "Hang up" picked once.
      const hold = {
        questionId: 'q2',
        percentCorrect: 0,
        wrongPicks: [{ text: 'Hang up', count: 1 }],
      };
      await expect
        .poll(() => courseReport(page, course.id), { timeout: 60_000 })
        .toMatchObject({
          report: { ...report, completionPercent: 33 },
          quizzes: [{ questions: [hold, { questionId: 'q1', percentCorrect: 100 }] }],
        });
    });
    await test.step('the screen shows 33% and the most-picked wrong answer', async () => {
      const reports = new ReportsPage(page);
      await reports.openCourse(course.title);
      await expect(reports.main.getByText('33%').first()).toBeVisible();
      await expect(reports.row(HOLD)).toContainText('Hang up');
    });
  });

  test('LN-22 past the due date, the report counts everyone not finished as overdue', async ({
    browser,
    page,
  }) => {
    needs('learningQuizzes', 'learningTestHooks');
    test.setTimeout(120_000);
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const casey = new PlayerPage(await pageFor(browser, 'commenter'));
    const val = await whoIs(await pageFor(browser, 'viewer'));
    const [eliMe, caseyMe] = [await whoIs(eli.page), await whoIs(casey.page)];
    const course =
      await test.step('Tara assigns Eli, Casey and Val a quiz course that was due yesterday', async () => {
        await signInAs(page, TARA);
        const course = await liveCourse(page, quizCourse());
        const people = [eliMe.id, caseyMe.id, val.id];
        const made = await assign(page, course.id, { people, dueDate: day() });
        // The API refuses a past due date; the test hook (#247) moves it (assign-data.ts).
        await setDueDate(page, made.id, day(-1));
        return course;
      });
    await test.step('Eli passes, late; Casey starts; Val does not', async () => {
      await takeQuiz(eli, course.id);
      await casey.start(course.id);
      await casey.startQuiz();
    });
    await test.step('within a minute: 2 overdue, Casey and Val, not Eli', async () => {
      const report = { total: 3, passed: 1, inProgress: 1, notStarted: 1, overdue: 2 };
      await expect
        .poll(() => courseReport(page, course.id), { timeout: 60_000 })
        .toMatchObject({ report });
    });
    await test.step('the CSV has 1 day overdue for Casey and Val, none for Eli', async () => {
      const reports = new ReportsPage(page);
      await reports.openCourse(course.title);
      const [header = [], ...rows] = await reports.downloadCsv();
      const overdue = (name: string) =>
        rows.find((row) => row[0] === name)?.[header.indexOf('Days overdue')];
      expect(overdue(eliMe.name), eliMe.name).toBe('');
      expect(overdue(caseyMe.name), caseyMe.name).toBe('1');
      expect(overdue(val.name), val.name).toBe('1');
    });
  });

  test('LN-28 a person’s transcript lists their courses with status, score and date', async ({
    browser,
    page,
  }) => {
    needs('learningQuizzes');
    test.setTimeout(120_000);
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const me = await whoIs(eli.page);
    const { passed, started } =
      await test.step('Tara assigns Eli a quiz course and a two-lesson course', async () => {
        await signInAs(page, TARA);
        const passed = await liveCourse(page, quizCourse());
        const started = await liveCourse(page, twoLessons());
        for (const { id } of [passed, started]) await assign(page, id, { people: [me.id] });
        return { passed, started };
      });
    await test.step('Eli passes the first and stops halfway through the second', async () => {
      await takeQuiz(eli, passed.id);
      await stopAfterLessonOne(eli, started.id);
    });
    await test.step('his transcript shows both, with status, score and date', async () => {
      const reports = new ReportsPage(page);
      await page.goto(`/learning/reports/people/${me.id}`);
      await reports.expectRowSoon(passed.title, /passed/i);
      await expect(reports.row(passed.title)).toContainText('100');
      await expect(reports.row(passed.title)).toContainText(await shownDayIn(page, new Date()));
      await reports.expectRowSoon(started.title, /in progress/i);
    });
    await test.step('Eli may read his own transcript, but not Casey’s', async () => {
      const casey = await whoIs(await pageFor(browser, 'commenter'));
      const api = await apiFor(eli.page);
      expect((await api.send('GET', `/api/learning/reports/people/${me.id}`)).status()).toBe(200);
      const theirs = await api.send('GET', `/api/learning/reports/people/${casey.id}`);
      expect(theirs.status()).toBe(403);
    });
  });
});
