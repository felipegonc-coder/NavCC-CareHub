// Learning acceptance checks: assigning courses with due dates. From the Learning PRD (section
// 4.2, and section 7, Phase 2 "Finished when"). Learning has no "Done means" list yet, so the IDs
// are the Testing lane's (LN-xx). Notice wording: packages/learning/src/delivery/notices.ts.
import type { APIResponse } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import {
  assign,
  assignBody,
  courseUrl,
  day,
  dueWords,
  linkToCourse,
  nextFriday,
  openCareHubChat,
  runReminders,
  setDueDate,
  shownDay,
  whoIs,
} from './assign-data.js';
import { TARA, content, liveCourse, pageFor } from './course-data.js';
import { LearnerPage } from './learner-page.js';

// The browser is in Tokyo: Learning shows days in the profile's time zone (decision 0317).
test.use({ timezoneId: 'Asia/Tokyo' });

const lesson = () => [content('l1', 'Fictional QA greeting')];
/** A whole course card on My learning: its title, due date and status. */
const cardOf = (learner: LearnerPage, title: string) =>
  learner.main.getByRole('article').filter({ has: learner.card(title) });
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
        const card = cardOf(learner, course.title);
        await expect(card).toBeVisible();
        await expect(card).toContainText(shownDay(due));
        await expect(card).toContainText('Required');
      });
    }
  });
});

test.describe('Learning: who may assign', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningAssign');

  test('LN-30 only people who may assign can assign: Eli is refused on screen and by the server', async ({
    browser,
    page,
  }) => {
    const course = await test.step('Tara publishes a course', async () => {
      await signInAs(page, TARA);
      return liveCourse(page, lesson());
    });
    const eliPage = await pageFor(browser, 'editor');
    await test.step('the Assign screen says he has no access, with no form', async () => {
      await eliPage.goto('/learning/assign');
      await expect(eliPage.getByRole('heading', { level: 1, name: 'Assign' })).toBeVisible();
      const alert = eliPage
        .getByRole('alert')
        .filter({ hasText: "You don't have access to this." });
      await expect(alert).toBeVisible();
      await expect(eliPage.getByLabel('Course or path')).toHaveCount(0);
      await expect(eliPage.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
    });
    await test.step('the server refuses his assignment with 403 and a plain message', async () => {
      const api = await apiFor(eliPage);
      const me = await whoIs(eliPage);
      const body = assignBody(course.id, { people: [me.id] });
      const response = await api.send('POST', '/api/learning/assignments', body);
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

// A past due date needs Learning's e2e test hook, see assign-data.ts.
test.describe('Learning: overdue courses', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningAssign', 'learningTestHooks');

  test('LN-29 an overdue course shows first in My learning, as overdue', async ({
    browser,
    page,
  }) => {
    const eli = new LearnerPage(await pageFor(browser, 'editor'));
    const { late, later } =
      await test.step('Tara assigns Eli one course due Friday and one due yesterday', async () => {
        await signInAs(page, TARA);
        const people = [(await whoIs(eli.page)).id];
        const [later, late] = [await liveCourse(page, lesson()), await liveCourse(page, lesson())];
        await assign(page, later.id, { people, dueDate: nextFriday() });
        const made = await assign(page, late.id, { people, dueDate: day() });
        await setDueDate(page, made.id, day(-1));
        return { late, later };
      });
    await test.step('My learning shows Overdue first, with the late course, marked overdue', async () => {
      await eli.page.goto('/learning');
      const section = (name: string) => eli.main.getByRole('region', { name, exact: true });
      await expect(section('Overdue')).toContainText(late.title);
      await expect(cardOf(eli, late.title)).toContainText(
        `Overdue: it was due ${shownDay(day(-1))}`,
      );
      await expect(section('Assigned to you')).toContainText(later.title);
      await expect(section('Overdue')).not.toContainText(later.title);
      const headings = await eli.main.getByRole('heading', { level: 2 }).allInnerTexts();
      expect(headings[0], 'the first section').toBe('Overdue');
    });
  });
});

// The reminders job runs through the jobs' e2e test hook, see assign-data.ts.
test.describe('Learning: reminders', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningAssign', 'jobsTestHooks', 'notices');

  test('LN-20 a reminder goes out the day before the due date, and an overdue nudge the day after', async ({
    browser,
    page,
  }) => {
    const due = day(3);
    const eli = new LearnerPage(await pageFor(browser, 'editor'));
    const avery = await pageFor(browser, 'admin'); // a site admin, who may run the reminders job
    const course = await test.step('Tara assigns Eli a course due in 3 days', async () => {
      await signInAs(page, TARA);
      const course = await liveCourse(page, lesson());
      await assign(page, course.id, { people: [(await whoIs(eli.page)).id], dueDate: due });
      return course;
    });
    const soon = `“${course.title}” is due tomorrow.`;
    await test.step('the day before, his 🔔 chat gets "Course due tomorrow"', async () => {
      await runReminders(avery, day(2));
      await runReminders(avery, day(2)); // a second run that day sends nothing new
      const chat = await openCareHubChat(eli.page);
      await expect(chat.getByText(soon).last()).toBeVisible();
      await expect(chat.getByText('Course due tomorrow').first()).toBeVisible();
    });
    await test.step('the day after, "Course overdue"; the reminder came once', async () => {
      await runReminders(avery, day(4));
      const chat = await openCareHubChat(eli.page);
      await expect(chat.getByText(`“${course.title}” was due yesterday.`).last()).toBeVisible();
      await expect(chat.getByText('Course overdue').first()).toBeVisible();
      // The chat list previews only the newest notice, so these are the chat's own copies.
      await expect(chat.getByText(soon), 'notices that it is due tomorrow').toHaveCount(1);
    });
    await avery.context().close();
  });
});
