// Learning acceptance checks: build, preview, publish and edit a live course. From the Learning PRD
// (section 7, Phase 1 "Finished when") and the Learning Phase 1 test checklist (sections 1, 2, 4
// and 5). Learning has no "Done means" list yet, so the IDs are the Testing lane's (LN-xx), and
// RP-02 is the Trainer role check of the roles list.
import type { APIResponse } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test, uniqueName } from '../_support/index.js';
import {
  TARA,
  choice,
  content,
  draftCourse,
  editCourse,
  PHASE_ONE_QUIZ,
  fiveQuestions,
  liveCourse,
  pageFor,
  quiz,
  trueFalse,
  type Course,
} from './course-data.js';
import { LearnerPage, NOT_FOUND, NO_ACCESS } from './learner-page.js';
import { StudioPage } from './studio-page.js';

type ErrorBody = { error: { code: string; message: string; issues?: { message: string }[] } };
const errorOf = async (response: APIResponse) => ((await response.json()) as ErrorBody).error;

test.describe('Learning: build and publish a course', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning');

  test('LN-01 a builder creates a course from Learning → Studio and the editor opens', async ({
    page,
  }) => {
    needs('learningStudio');
    const studio = new StudioPage(page);
    const title = uniqueName('Fictional QA course');
    await test.step('Tara opens Learning → Studio', async () => {
      await signInAs(page, TARA);
      await page.goto('/learning');
      await page.getByRole('link', { name: 'Studio' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();
      await expect(page).toHaveTitle(/^Care Hub · /);
    });
    await test.step('New course opens the course editor with its title', async () => {
      await studio.newCourse(title);
      await expect(studio.courseTitle).toHaveValue(title);
    });
  });

  test('LN-02 three lessons, a knowledge check, a 5-question quiz and a minimum time save on their own', async ({
    page,
  }) => {
    needs('learningStudio');
    const studio = new StudioPage(page);
    const lessons = [
      'Fictional QA greeting',
      'Fictional QA holds',
      'Fictional QA wrap-up',
    ] as const;
    await test.step('Tara starts a new course', async () => {
      await signInAs(page, TARA);
      await studio.open();
      await studio.newCourse(uniqueName('Fictional QA course'));
    });
    await test.step('she adds three lessons, with a minimum time of 60 s on lesson 1', async () => {
      for (const title of lessons) await studio.addLesson(title);
      await studio.lesson(lessons[0]).click();
      await studio.setMinimumTime(60);
    });
    await test.step('she adds a knowledge check to lesson 2', async () => {
      await studio.lesson(lessons[1]).click();
      await studio.addBlock('Knowledge check');
    });
    await test.step('she adds a final quiz with five questions, one of them matching', async () => {
      await studio.addLesson('Fictional QA final quiz', 'quiz');
      for (const question of PHASE_ONE_QUIZ) await studio.addQuestion(question);
    });
    await test.step('it saves on its own, with no error message', async () => {
      await expect(studio.saved).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
    await test.step('after a reload, everything she added is still there', async () => {
      const courseId = new URL(page.url()).pathname.split('/').pop() ?? '';
      await page.reload();
      for (const title of [...lessons, 'Fictional QA final quiz']) {
        await expect(studio.lesson(title)).toBeVisible();
      }
      const path = `/api/learning/studio/courses/${courseId}`;
      const { course } = await (await apiFor(page)).get<{ course: Course }>(path);
      const [first, second, , final] = course.lessons;
      expect(first?.minimumSeconds).toBe(60);
      expect(JSON.stringify(second?.blocks)).toContain('"type":"knowledge_check"');
      expect(final?.kind).toBe('quiz');
      const types = (final?.questions as { type: string }[] | undefined)?.map((q) => q.type);
      expect(types?.join()).toBe('single_choice,multiple_choice,true_false,matching,single_choice');
    });
  });

  test('LN-04 Publish says in plain words what to fix, then publishes', async ({ page }) => {
    needs('learningStudio');
    const studio = new StudioPage(page);
    const lessons = (correct: boolean) => [
      content('l1', 'Fictional QA greeting'),
      quiz('l2', 'Fictional QA final quiz', [
        trueFalse('q1', 'You greet the caller first.', true),
        trueFalse('q2', 'You tell the caller before a hold.', true),
        choice('q3', 'Which hold music is approved?', correct ? ['Tune A'] : [], ['Tune B']),
      ]),
    ];
    const course =
      await test.step('Tara has a draft whose question 3 has no right answer', async () => {
        await signInAs(page, TARA);
        return draftCourse(page, lessons(false));
      });
    await test.step('Publish names the lesson and question to fix, and does not publish', async () => {
      await studio.open(course.id);
      await studio.main.getByRole('button', { name: 'Publish' }).click();
      const problem = /Lesson 2 .Fictional QA final quiz.: question 3 has no correct answer\./;
      await expect(page.getByText(problem)).toBeVisible();
      const api = await apiFor(page);
      const refused = await api.send('POST', `/api/learning/studio/courses/${course.id}/publish`, {
        notify: 'none',
      });
      expect(refused.status()).toBe(422);
      const issues = (await errorOf(refused)).issues?.map((issue) => issue.message);
      expect(issues).toContainEqual(expect.stringMatching(problem));
      expect((await api.send('GET', `/api/learning/courses/${course.id}`)).status()).toBe(404);
    });
    await test.step('once the answer is ticked, Publish publishes it', async () => {
      await editCourse(page, course.id, (draft) => ({ ...draft, lessons: lessons(true) }));
      await page.reload();
      await studio.publish();
      await (await apiFor(page)).get(`/api/learning/courses/${course.id}`);
    });
  });

  test('LN-05 a learner sees a published course in the Catalog, and no drafts', async ({
    browser,
    page,
  }) => {
    const tag = uniqueName('Fictional QA catalog');
    const { live, draft } =
      await test.step('Tara publishes one course and keeps one as a draft', async () => {
        await signInAs(page, TARA);
        const lessons = [content('l1', 'Fictional QA greeting')];
        const live = await liveCourse(page, lessons, { title: `${tag} live` });
        return { live, draft: await draftCourse(page, lessons, { title: `${tag} draft` }) };
      });
    await test.step('Eli finds the published course in the Catalog, and not the draft', async () => {
      const eli = new LearnerPage(await pageFor(browser, 'editor'));
      await eli.catalog(tag);
      await expect(eli.card(live.title)).toBeVisible();
      await expect(eli.card(draft.title)).toHaveCount(0);
    });
  });

  test('LN-14 an unpublished course appears nowhere for a learner, not even by its link', async ({
    browser,
    page,
  }) => {
    const draft = await test.step('Tara keeps a course unpublished', async () => {
      await signInAs(page, TARA);
      return draftCourse(page, [content('l1', 'Fictional QA greeting')]);
    });
    const eliPage = await pageFor(browser, 'editor');
    await test.step("Eli doesn't find it in My learning (LN-05 covers the Catalog)", async () => {
      await eliPage.goto('/learning');
      await expect(eliPage.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();
      await expect(eliPage.getByText(draft.title)).toHaveCount(0);
    });
    await test.step('its links say the link is wrong, without the course', async () => {
      for (const path of [
        `/learning/courses/${draft.id}`,
        `/learning/courses/${draft.id}/lessons/l1`,
      ]) {
        await eliPage.goto(path);
        await expect(eliPage.getByText(NOT_FOUND)).toBeVisible();
        await expect(eliPage.getByText(draft.title)).toHaveCount(0);
      }
    });
    await test.step('the server answers 404 too', async () => {
      const api = await apiFor(eliPage);
      const response = await api.send('GET', `/api/learning/courses/${draft.id}`);
      expect(response.status()).toBe(404);
      expect((await errorOf(response)).message).toBe(NOT_FOUND);
    });
  });

  test('RP-02 the Trainer role builds on screen and by request; an Editor is refused both ways', async ({
    browser,
    page,
  }) => {
    needs('learningStudio');
    const course =
      await test.step('Tara has Studio in Learning, and her requests work', async () => {
        await signInAs(page, TARA);
        await page.goto('/learning');
        await expect(page.getByRole('link', { name: 'Studio' })).toBeVisible();
        return draftCourse(page, [content('l1', 'Fictional QA greeting')]);
      });
    const eliPage = await pageFor(browser, 'editor');
    await test.step('Eli has no Studio in Learning', async () => {
      await eliPage.goto('/learning');
      await expect(eliPage.getByRole('heading', { level: 1, name: 'My learning' })).toBeVisible();
      await expect(eliPage.getByRole('link', { name: 'Studio' })).toHaveCount(0);
    });
    await test.step('a Studio link says he has no access, and never shows the editor', async () => {
      await eliPage.goto(`/learning/studio/courses/${course.id}`);
      await expect(eliPage.getByText(NO_ACCESS)).toBeVisible();
      await expect(eliPage.getByRole('button', { name: 'Publish' })).toHaveCount(0);
      await expect(eliPage.getByText(course.title)).toHaveCount(0);
    });
    await test.step('the server refuses his requests with 403 and a plain message', async () => {
      const api = await apiFor(eliPage);
      const save = await api.send('PUT', `/api/learning/studio/courses/${course.id}`, {
        course,
        revision: 1,
      });
      expect(save.status()).toBe(403);
      expect((await errorOf(save)).message).toBe("You don't have access to this.");
      const create = await api.send('POST', '/api/learning/studio/courses', { type: 'standard' });
      expect(create.status()).toBe(403);
    });
  });
});

test.describe('Learning: preview on a phone', () => {
  onlyIn('desktop-light', 'phone-light');
  needs('signIn', 'learning', 'learningStudio');

  test('LN-03 Preview → 📱 Phone shows every lesson and the quiz, fitting the screen', async ({
    page,
    isMobile,
  }) => {
    const learner = new LearnerPage(page);
    const course = await test.step('Tara has a draft with three lessons and a quiz', async () => {
      await signInAs(page, TARA);
      return draftCourse(page, [
        content('l1', 'Fictional QA greeting'),
        content('l2', 'Fictional QA holds'),
        content('l3', 'Fictional QA wrap-up'),
        quiz('l4', 'Fictional QA final quiz', fiveQuestions()),
      ]);
    });
    await test.step(
      isMobile ? 'she opens the preview on her phone' : 'Preview → 📱 Phone',
      async () => {
        if (isMobile) {
          await page.goto(`/learning/studio/courses/${course.id}/preview`);
        } else {
          const studio = new StudioPage(page);
          await studio.open(course.id);
          await studio.previewOnPhone();
        }
      },
    );
    for (const lesson of course.lessons) {
      await test.step(`"${lesson.title}" shows and fits the screen`, async () => {
        await expect(learner.lessonHeading(lesson.title)).toBeVisible();
        if (isMobile) {
          const fits = () =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
          await expect.poll(fits).toBe(true);
        }
        if (lesson.kind === 'content') await learner.next();
      });
    }
    await test.step('the quiz can be started from the preview', async () => {
      await expect(learner.main.getByRole('button', { name: /^start/i })).toBeVisible();
    });
  });
});
