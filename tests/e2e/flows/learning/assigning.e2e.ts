// Learning acceptance checks: assigning courses with due dates. From the Learning PRD (section
// 4.2, and section 7, Phase 2 "Finished when"). Learning has no "Done means" list yet, so the IDs
// are the Testing lane's (LN-xx). Notice wording: packages/learning/src/delivery/notices.ts.
import type { APIResponse } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import {
  assign,
  courseUrl,
  day,
  dueWords,
  linkToCourse,
  nextFriday,
  openCareHubChat,
  shownDay,
  whoIs,
} from './assign-data.js';
import { TARA, content, liveCourse, pageFor } from './course-data.js';
import { LearnerPage, NO_ACCESS } from './learner-page.js';

const lesson = () => [content('l1', 'Fictional QA greeting')];
const messageOf = async (response: APIResponse) =>
  ((await response.json()) as { error: { message: string } }).error.message;

test.describe('Learning: assign courses', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningAssign', 'notices');

  test('LN-18 everyone assigned gets a Care Hub notice and sees the course in My learning', async ({
    browser,
    page,
  }) => {
    const due = nextFriday();
    const eli = new LearnerPage(await pageFor(browser, 'editor'));
    const casey = new LearnerPage(await pageFor(browser, 'commenter'));
    const course =
      await test.step('Tara assigns a course to Eli and Casey, due Friday', async () => {
        await signInAs(page, TARA);
        const course = await liveCourse(page, lesson());
        const people = [(await whoIs(eli.page)).id, (await whoIs(casey.page)).id];
        await assign(page, course.id, { people, dueDate: due });
        return course;
      });
    for (const learner of [eli, casey]) {
      await test.step('the 🔔 Care Hub notice names the course, and Open course opens it', async () => {
        const chat = await openCareHubChat(learner.page);
        const text = `You've been assigned “${course.title}”, ${dueWords(due)}.`;
        await expect(chat.getByText(text)).toBeVisible();
        await expect(chat.getByText('New course assigned').first()).toBeVisible();
        const open = chat.getByRole('link', { name: 'Open course' });
        await open.and(linkToCourse(chat, course.id)).click();
        await expect(learner.page).toHaveURL(courseUrl(course.id));
      });
      await test.step('My learning shows it with its due date', async () => {
        await learner.page.goto('/learning');
        const card = learner.card(course.title);
        await expect(card).toBeVisible();
        await expect(card).toContainText(shownDay(due));
      });
    }
  });

  test('LN-29 an overdue course shows first in My learning, as overdue', async ({
    browser,
    page,
  }) => {
    const eli = new LearnerPage(await pageFor(browser, 'editor'));
    const { late, later } =
      await test.step('Tara assigns Eli one course due yesterday and one due Friday', async () => {
        await signInAs(page, TARA);
        const eliId = (await whoIs(eli.page)).id;
        const late = await liveCourse(page, lesson());
        const later = await liveCourse(page, lesson());
        await assign(page, late.id, { people: [eliId], dueDate: day(-1) });
        await assign(page, later.id, { people: [eliId], dueDate: nextFriday() });
        return { late, later };
      });
    await test.step('My learning lists the overdue one first, marked overdue', async () => {
      await eli.page.goto('/learning');
      await expect(eli.card(later.title)).toBeVisible();
      await expect(eli.card(late.title)).toContainText(/overdue/i);
      const titles = await eli.main.getByRole('link').allTextContents();
      const at = (title: string) => titles.findIndex((text) => text.includes(title));
      expect(at(late.title)).toBeLessThan(at(later.title));
    });
    await test.step('its notice says when it was due', async () => {
      const chat = await openCareHubChat(eli.page);
      const text = `You've been assigned “${late.title}”, ${dueWords(day(-1))}.`;
      await expect(chat.getByText(text)).toBeVisible();
    });
  });

  test('LN-30 only people who may assign can assign: Eli is refused on screen and by the server', async ({
    browser,
    page,
  }) => {
    const course = await test.step('Tara publishes a course', async () => {
      await signInAs(page, TARA);
      return liveCourse(page, lesson());
    });
    const eliPage = await pageFor(browser, 'editor');
    await test.step('the assign screen says he has no access', async () => {
      await eliPage.goto('/learning/assign');
      await expect(eliPage.getByText(NO_ACCESS)).toBeVisible();
      await expect(eliPage.getByRole('button', { name: /^assign/i })).toHaveCount(0);
    });
    await test.step('the server refuses his assignment with 403 and a plain message', async () => {
      const api = await apiFor(eliPage);
      const me = await whoIs(eliPage);
      const response = await api.send('POST', '/api/learning/assignments', {
        target: { kind: 'course', courseId: course.id },
        people: [me.id],
        groups: [],
      });
      expect(response.status()).toBe(403);
      expect(await messageOf(response)).toBe("You don't have access to this.");
      expect((await api.send('GET', '/api/learning/assignments')).status()).toBe(403);
    });
  });
});

test.describe('Learning: due dates on the calendar', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningAssign', 'calendar');

  test('LN-23 a due date shows on the learner’s Care Hub calendar and opens the course', async ({
    browser,
    page,
  }) => {
    const eli = new LearnerPage(await pageFor(browser, 'editor'));
    const course = await test.step('Tara assigns Eli a course due today', async () => {
      await signInAs(page, TARA);
      const course = await liveCourse(page, lesson());
      await assign(page, course.id, { people: [(await whoIs(eli.page)).id], dueDate: day() });
      return course;
    });
    await test.step('his calendar shows it today, and it opens the course', async () => {
      await eli.page.goto('/calendar');
      await eli.main.getByText(course.title).first().click();
      // The item links to the course itself, or opens a panel that does.
      await expect(async () => {
        if (!courseUrl(course.id).test(eli.page.url())) {
          await linkToCourse(eli.page, course.id).last().click({ timeout: 2_000 });
        }
        expect(eli.page.url()).toMatch(courseUrl(course.id));
      }).toPass({ timeout: 15_000 });
    });
  });
});
