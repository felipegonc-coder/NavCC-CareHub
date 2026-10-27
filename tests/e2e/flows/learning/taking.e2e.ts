// Learning acceptance checks: taking a course. From the Learning PRD (sections 4.1, 4.2 and 5, and
// section 7, Phase 1 "Finished when") and the Learning Phase 1 test checklist (sections 2, 5 and
// 6). Learning has no "Done means" list yet, so the IDs are the Testing lane's (LN-xx).
import type { Locator } from '@playwright/test';
import { expect, needs, onlyIn, shownDate, signInAs, test } from '../_support/index.js';
import {
  TARA,
  content,
  editCourse,
  liveCourse,
  pageFor,
  publish,
  quiz,
  trueFalse,
} from './course-data.js';
import { PlayerPage } from './player-page.js';

const greet = trueFalse('q1', 'You greet the caller first.', true);
const hold = trueFalse('q2', 'You hang up during a hold.', false);

test.describe('Learning: take a course', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning');

  test('LN-06 finishing a lesson before its minimum time asks for a bit more time', async ({
    browser,
    page,
  }) => {
    const course = await test.step('Tara publishes a course whose lesson 1 needs 5 s', async () => {
      await signInAs(page, TARA);
      return liveCourse(page, [
        content('l1', 'Fictional QA greeting', { minimumSeconds: 5 }),
        content('l2', 'Fictional QA holds'),
      ]);
    });
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    await test.step('Eli tries to finish lesson 1 straight away', async () => {
      await eli.start(course.id);
      await expect(eli.lessonHeading('Fictional QA greeting')).toBeVisible();
      if (await eli.nextButton.isEnabled()) await eli.nextButton.click();
      await expect(eli.main.getByText(/more time/i)).toBeVisible();
      await expect(eli.lessonHeading('Fictional QA greeting')).toBeVisible();
    });
    await test.step('once the minimum time has passed, he carries on', async () => {
      await eli.page.waitForTimeout(6_000); // the minimum time rule itself (PRD 4.1, Rules)
      await eli.nextButton.click();
      await expect(eli.lessonHeading('Fictional QA holds')).toBeVisible();
    });
  });

  test('LN-07 a learner stops halfway on a computer and finishes on a phone where they left off', async ({
    browser,
    page,
  }) => {
    const course = await test.step('Tara publishes three lessons and a quiz', async () => {
      await signInAs(page, TARA);
      return liveCourse(page, [
        content('l1', 'Fictional QA greeting'),
        content('l2', 'Fictional QA holds'),
        content('l3', 'Fictional QA wrap-up'),
        quiz('l4', 'Fictional QA final quiz', [greet]),
      ]);
    });
    await test.step('on a computer, Eli finishes lesson 1, opens lesson 2 and closes it', async () => {
      const computer = new PlayerPage(await pageFor(browser, 'editor'));
      await computer.start(course.id);
      await computer.nextButton.click();
      await expect(computer.lessonHeading('Fictional QA holds')).toBeVisible();
      await expect
        .poll(async () => (await computer.progress(course.id)).resume?.lessonId)
        .toBe('l2');
      await computer.page.context().close();
    });
    const phone = await PlayerPage.onPhone(browser, 'editor');
    await test.step('on a phone, My learning opens the course right where he stopped', async () => {
      await phone.resumeFromMyLearning(course.title);
      await expect(phone.lessonHeading('Fictional QA holds')).toBeVisible();
    });
    await test.step('he finishes the lessons and passes the quiz on the phone', async () => {
      await phone.nextButton.click();
      await expect(phone.lessonHeading('Fictional QA wrap-up')).toBeVisible();
      await phone.nextButton.click();
      await phone.startQuiz();
      await phone.answerTrueFalse('You greet the caller first.', true);
      await phone.submit();
      await expect(phone.score(100)).toBeVisible();
      expect((await phone.progress(course.id)).status).toBe('passed');
    });
  });

  test('LN-08 a failed quiz can be retried; the score shows, the right answers only as set', async ({
    browser,
    page,
  }) => {
    const course =
      await test.step('Tara publishes a quiz: pass 100, 3 tries, answers after passing', async () => {
        await signInAs(page, TARA);
        const settings = { passMark: 100, maxAttempts: 3, revealAnswers: 'after_passing' };
        return liveCourse(page, [quiz('l1', 'Fictional QA final quiz', [greet, hold], settings)]);
      });
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    await test.step('Eli fails on purpose: 50%, and no right answers yet', async () => {
      await eli.start(course.id);
      await eli.startQuiz();
      await eli.answerTrueFalse('You greet the caller first.', true);
      await eli.answerTrueFalse('You hang up during a hold.', true);
      await eli.submit();
      await expect(eli.score(50)).toBeVisible();
      await expect(eli.rightAnswers).toHaveCount(0);
      expect((await eli.progress(course.id)).status).not.toBe('passed');
    });
    await test.step('he tries again and passes: 100%, and now the right answers', async () => {
      await eli.retry.click();
      await eli.answerTrueFalse('You greet the caller first.', true);
      await eli.answerTrueFalse('You hang up during a hold.', false);
      await eli.submit();
      await expect(eli.score(100)).toBeVisible();
      await expect(eli.rightAnswers.first()).toBeVisible();
      expect((await eli.progress(course.id)).status).toBe('passed');
    });
  });

  test('LN-16 republishing a live course keeps a mid-course learner on their version', async ({
    browser,
    page,
  }) => {
    const version = (n: 'first' | 'second') => [
      content('l1', 'Fictional QA greeting'),
      content('l2', `Fictional QA holds, ${n} version`),
      quiz('l3', 'Fictional QA final quiz', [trueFalse('q1', `${n} version: greet first.`, true)]),
    ];
    const course = await test.step('Tara publishes version 1', async () => {
      await signInAs(page, TARA);
      return liveCourse(page, version('first'));
    });
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    await test.step('Eli starts it and stops in lesson 1', async () => {
      await eli.start(course.id);
      await expect(eli.lessonHeading('Fictional QA greeting')).toBeVisible();
    });
    await test.step('Tara renames lesson 2, changes the question and publishes again', async () => {
      await editCourse(page, course.id, (draft) => ({ ...draft, lessons: version('second') }));
      expect(await publish(page, course.id)).toBe(2);
    });
    await test.step('Eli carries on in the version he started and finishes it', async () => {
      await eli.page.reload();
      await expect(eli.outline.getByText('Fictional QA holds, first version')).toBeVisible();
      await expect(eli.outline.getByText('Fictional QA holds, second version')).toHaveCount(0);
      await eli.nextButton.click();
      await expect(eli.lessonHeading('Fictional QA holds, first version')).toBeVisible();
      await eli.nextButton.click();
      await eli.startQuiz();
      await eli.answerTrueFalse('first version: greet first.', true);
      await eli.submit();
      expect((await eli.progress(course.id)).status).toBe('passed');
    });
    await test.step('a new learner gets version 2', async () => {
      const casey = new PlayerPage(await pageFor(browser, 'commenter'));
      await casey.start(course.id);
      await expect(casey.outline.getByText('Fictional QA holds, second version')).toBeVisible();
    });
  });

  test('LN-24 a Required Read ends with "I have read and understood", kept with its date', async ({
    browser,
    page,
  }) => {
    const statement = 'I have read and understood the fictional QA hold policy.';
    const course = await test.step('Tara publishes a Required Read without a quiz', async () => {
      await signInAs(page, TARA);
      const completion = {
        requireAllLessons: true,
        requireQuizPass: false,
        requireAcknowledgement: true,
      };
      return liveCourse(page, [content('l1', 'Fictional QA hold policy')], {
        type: 'required_read',
        settings: { lessonOrder: 'sequential', completion, acknowledgement: { statement } },
      });
    });
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    await test.step('Eli reads it and signs it off', async () => {
      await eli.start(course.id);
      await eli.nextButton.click();
      await eli.main.getByRole('checkbox', { name: statement }).check();
      await eli.main.getByRole('button', { name: /^(confirm|sign|submit|complete)/i }).click();
    });
    await test.step('the course is complete and shows the day of the sign-off', async () => {
      const progress = await eli.progress(course.id);
      expect(progress.status).toBe('completed');
      const signedAt = new Date(progress.acknowledgedAt ?? '');
      expect(Math.abs(Date.now() - signedAt.getTime())).toBeLessThan(5 * 60_000);
      await eli.page.goto(`/learning/courses/${course.id}`);
      await expect(eli.main.getByText(shownDate(signedAt))).toBeVisible();
    });
  });

  test('LN-25 progress made offline is kept and sent once the connection is back', async ({
    browser,
    page,
  }) => {
    const course = await test.step('Tara publishes three lessons', async () => {
      await signInAs(page, TARA);
      return liveCourse(page, [
        content('l1', 'Fictional QA greeting'),
        content('l2', 'Fictional QA holds'),
        content('l3', 'Fictional QA wrap-up'),
      ]);
    });
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    await test.step('Eli loses the connection and finishes lesson 1 anyway', async () => {
      await eli.start(course.id);
      await eli.page.context().setOffline(true);
      await eli.nextButton.click();
      await expect(eli.lessonHeading('Fictional QA holds')).toBeVisible();
    });
    await test.step('once he is back online, another device resumes at lesson 2', async () => {
      await eli.page.context().setOffline(false);
      const lessonId = async () => (await eli.progress(course.id)).resume?.lessonId;
      await expect.poll(lessonId, { timeout: 30_000 }).toBe('l2');
      const phone = await PlayerPage.onPhone(browser, 'editor');
      await phone.resumeFromMyLearning(course.title);
      await expect(phone.lessonHeading('Fictional QA holds')).toBeVisible();
    });
  });
});

test.describe('Learning on a phone', () => {
  onlyIn('phone-light');
  needs('signIn', 'appShell', 'learning');

  test('LN-17 on a phone, Learning, a lesson and the quiz fit the screen and are easy to tap', async ({
    browser,
    page,
  }) => {
    const course = await test.step('Tara publishes a lesson and a quiz', async () => {
      await signInAs(page, TARA);
      return liveCourse(page, [
        content('l1', 'Fictional QA greeting'),
        quiz('l2', 'Fictional QA final quiz', [greet]),
      ]);
    });
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const fits = () =>
      eli.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const tappable = async (target: Locator) => {
      const box = await target.boundingBox();
      expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(44);
    };
    await test.step('the phone menu has Learning', async () => {
      await eli.page.goto('/');
      await eli.page.getByRole('button', { name: /^(open )?menu$/i }).click();
      const learning = eli.page.getByRole('link', { name: 'Learning' });
      await tappable(learning);
      await learning.click();
      await expect(eli.page.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();
    });
    await test.step('a lesson fits the screen and Next is easy to tap', async () => {
      await eli.start(course.id);
      await expect.poll(fits).toBe(true);
      await tappable(eli.nextButton);
      await eli.nextButton.click();
    });
    await test.step('the quiz fits the screen and Submit is easy to tap', async () => {
      await eli.startQuiz();
      await eli.answerTrueFalse('You greet the caller first.', true);
      await expect.poll(fits).toBe(true);
      await tappable(eli.main.getByRole('button', { name: /^submit/i }));
    });
  });
});
