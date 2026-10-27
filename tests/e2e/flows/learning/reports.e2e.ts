// Learning acceptance checks: reports. From the Learning PRD (section 4.3, and section 7, Phase 1
// and Phase 2 "Finished when") and the Learning Phase 1 test checklist (sections 3 and 4). Learning
// has no "Done means" list yet, so the IDs are the Testing lane's (LN-xx). CSV columns and report
// numbers: packages/learning/src/reports (csv.ts, course-report.ts, question-analysis.ts).
import type { APIResponse } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, shownDate, signInAs, test } from '../_support/index.js';
import { assign, day, whoIs } from './assign-data.js';
import { TARA, choice, content, liveCourse, pageFor, quiz, trueFalse } from './course-data.js';
import { NO_ACCESS } from './learner-page.js';
import { PlayerPage } from './player-page.js';
import { ReportsPage } from './reports-page.js';

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

/** The shallowest value under `key` in a JSON answer (the report's wrapper isn't fixed yet). */
function valueOf(json: unknown, key: string): unknown {
  const queue = [json];
  for (const value of queue) {
    if (value === null || typeof value !== 'object') continue;
    if (!Array.isArray(value) && key in value) return (value as Record<string, unknown>)[key];
    queue.push(...Object.values(value));
  }
  return undefined;
}

test.describe('Learning: reports', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningAssign');

  test('LN-09 within a minute of a learner finishing, the course report shows result, score and time', async ({
    browser,
    page,
  }) => {
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
      expect(header?.slice(0, 4)).toEqual(['Name', 'Status', 'Score', 'Time spent (minutes)']);
      const line = (name: string) => lines.find((cells) => cells[0] === name)?.slice(1, 3);
      expect(line(me.name)).toEqual(['Passed', '100']);
      expect(line(casey.name)).toEqual(['Not started', '']);
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
      const start = /^start/i;
      const startButton = eli.main.getByRole('button', { name: start });
      await expect(startButton.or(eli.main.getByRole('link', { name: start }))).toBeVisible();
      await expect(eli.main.getByRole('button', { name: /^(resume|continue)/i })).toHaveCount(0);
      await eli.start(course.id);
      await expect(eli.lessonHeading('Fictional QA lesson one')).toBeVisible();
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

  test('LN-22 the course report counts finished, in progress, not started and overdue, and names the most-missed question', async ({
    browser,
    page,
  }) => {
    test.setTimeout(120_000);
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const casey = new PlayerPage(await pageFor(browser, 'commenter'));
    const val = await whoIs(await pageFor(browser, 'viewer'));
    const [eliMe, caseyMe] = [await whoIs(eli.page), await whoIs(casey.page)];
    const course =
      await test.step('Tara assigns a quiz course to Eli, Casey and Val, due yesterday', async () => {
        await signInAs(page, TARA);
        const course = await liveCourse(page, quizCourse());
        const people = [eliMe.id, caseyMe.id, val.id];
        await assign(page, course.id, { people, dueDate: day(-1) });
        return course;
      });
    await test.step('Eli passes with the hold question wrong; Casey starts; Val does not', async () => {
      await takeQuiz(eli, course.id, false);
      await casey.start(course.id);
      await casey.startQuiz();
    });
    const reports = new ReportsPage(page);
    await test.step('the report shows 33% finished: 1 passed, 1 in progress, 1 not started, 2 overdue', async () => {
      const api = await apiFor(page);
      const keys = ['total', 'passed', 'inProgress', 'notStarted', 'overdue', 'completionPercent'];
      const path = `/api/learning/reports/courses/${course.id}`;
      const numbers = async () => {
        const report = await api.get<unknown>(path);
        return [...keys.map((key) => valueOf(report, key)), valueOf(report, 'questionId')];
      };
      // Within a minute, like LN-09; the first question in the analysis is the most missed.
      await expect.poll(numbers, { timeout: 60_000 }).toEqual([3, 1, 1, 1, 2, 33, 'q2']);
      await reports.openCourse(course.title);
      await expect(reports.main.getByText('33%').first()).toBeVisible();
    });
    await test.step('it names the most-missed question and the wrong answer picked', async () => {
      await expect(reports.main.getByText(HOLD)).toBeVisible();
      await expect(reports.main.getByText('Hang up')).toBeVisible();
    });
  });

  test('LN-28 a person’s transcript lists their courses with status, score and date', async ({
    browser,
    page,
  }) => {
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
      await expect(reports.row(passed.title)).toContainText(shownDate(new Date()));
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
