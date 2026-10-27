// FLOW-03, a cross-area flow: assign a course, take it, get the certificate. From the Learning PRD
// (section 7, Phase 2 "Finished when"), the 🔔 Care Hub chat (decision 0007, notices) and Home and
// reminders (HR-04, which the Specs page links to this flow). Notice wording:
// packages/learning/src/delivery/notices.ts; certificate fields: packages/learning/src/certificates.
import type { Page } from '@playwright/test';
import { apiFor, expect, needs, onlyIn, shownDate, signInAs, test } from '../_support/index.js';
import {
  assign,
  courseUrl,
  day,
  dueWords,
  linkToCourse,
  nextFriday,
  openCareHubChat,
  whoIs,
} from '../learning/assign-data.js';
import { TARA, content, liveCourse, pageFor, quiz, trueFalse } from '../learning/course-data.js';
import { NO_ACCESS } from '../learning/learner-page.js';
import { PlayerPage } from '../learning/player-page.js';
import { ReportsPage } from '../learning/reports-page.js';

const GREET = 'You greet the caller first.';
/** A certificate's verification code: XXXX-XXXX-XXXX in Crockford base32. */
const CODE = /[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;

/** Learning → Assign (/learning/assign): a course, one person and a due date, then Assign. */
async function assignOnScreen(page: Page, title: string, person: string, dueDate: string) {
  await page.goto('/learning/assign');
  const main = page.getByRole('main');
  await main.getByRole('combobox', { name: /course/i }).fill(title);
  await page.getByRole('option', { name: title }).click();
  await main.getByRole('combobox', { name: /people/i }).fill(person);
  await page.getByRole('option', { name: person }).click();
  await main.getByLabel(/due date/i).fill(dueDate);
  await main.getByRole('button', { name: /^assign/i }).click();
}

test.describe('Cross-area: assign a course, take it, get the certificate', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningAssign', 'certificates', 'notices');

  test('FLOW-03 Tara assigns Eli a course; he gets the notice, passes, gets a certificate and shows as passed', async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000);
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const me = await whoIs(eli.page);
    const due = nextFriday();
    const course =
      await test.step('Tara publishes a short course with a quiz and a certificate', async () => {
        await signInAs(page, TARA);
        const check = quiz('l2', 'Fictional QA check', [trueFalse('q1', GREET, true)]);
        const lessons = [content('l1', 'Fictional QA welcome'), check];
        return liveCourse(page, lessons, { settings: { certificate: { enabled: true } } });
      });
    await test.step('on Learning → Assign, she assigns it to Eli, due Friday', async () => {
      await assignOnScreen(page, course.title, me.name, due);
      const api = await apiFor(page);
      await expect
        .poll(async () => JSON.stringify(await api.get<unknown>('/api/learning/assignments')))
        .toContain(course.id);
    });
    await test.step('Eli’s 🔔 Care Hub notice says it is due and opens it', async () => {
      const chat = await openCareHubChat(eli.page);
      const text = `You've been assigned “${course.title}”, ${dueWords(due)}.`;
      await expect(chat.getByText(text)).toBeVisible();
      const open = chat.getByRole('link', { name: 'Open course' });
      await open.and(linkToCourse(chat, course.id)).click();
      await expect(eli.page).toHaveURL(courseUrl(course.id));
    });
    await test.step('he reads the lesson and passes the quiz', async () => {
      await eli.start(course.id);
      await eli.next();
      await eli.startQuiz();
      await eli.answerTrueFalse(GREET, true);
      await eli.submit();
      await expect(eli.score(100)).toBeVisible();
    });
    await test.step('his certificate has his name, today’s date and a code that checks out', async () => {
      await eli.page.goto('/learning/certificates');
      await eli.main.getByRole('link', { name: course.title }).click();
      await expect(eli.main.getByText(me.name).first()).toBeVisible();
      await expect(eli.main.getByText(shownDate(new Date())).first()).toBeVisible();
      const shown = (await eli.main.getByText(CODE).first().textContent()) ?? '';
      expect(shown).toMatch(CODE);
      const code = shown.match(CODE)?.[0] ?? '';
      const found = await (
        await apiFor(page)
      ).get<{ learnerName: string; courseTitle: string }[]>(
        `/api/learning/certificates?code=${code}`,
      );
      expect(found.map((it) => [it.learnerName, it.courseTitle])).toEqual([
        [me.name, course.title],
      ]);
    });
    await test.step('Tara’s course report shows him as passed', async () => {
      const reports = new ReportsPage(page);
      await reports.openCourse(course.title);
      await reports.expectRowSoon(me.name, /passed/i);
    });
    await test.step('Eli still can’t build: Studio says no access and the API answers 403', async () => {
      await eli.page.goto('/learning/studio');
      await expect(eli.page.getByText(NO_ACCESS)).toBeVisible();
      const made = await (
        await apiFor(eli.page)
      ).send('POST', '/api/learning/studio/courses', {
        type: 'standard',
        title: 'Fictional QA not allowed',
      });
      expect(made.status()).toBe(403);
    });
  });
});

test.describe('Home: My learning', () => {
  onlyIn('desktop-light');
  needs('signIn', 'home', 'learning', 'learningAssign');

  test('HR-04 Home’s My learning lists assigned courses with the overdue ones first, marked Overdue', async ({
    browser,
    page,
  }) => {
    const eli = await pageFor(browser, 'editor');
    const eliId = (await whoIs(eli)).id;
    const late =
      await test.step('Tara assigns Eli one course due yesterday and one due Friday', async () => {
        await signInAs(page, TARA);
        const late = await liveCourse(page, [content('l1', 'Fictional QA greeting')]);
        const later = await liveCourse(page, [content('l1', 'Fictional QA greeting')]);
        await assign(page, late.id, { people: [eliId], dueDate: day(-1) });
        await assign(page, later.id, { people: [eliId], dueDate: nextFriday() });
        return late;
      });
    const section = eli.getByRole('region', { name: 'My learning' });
    await test.step('Home → My learning: every overdue course comes first, with the word Overdue', async () => {
      await eli.goto('/');
      const items = section.getByRole('listitem');
      await expect(items.filter({ hasText: late.title })).toContainText('Overdue');
      const texts = await items.allTextContents();
      const lastOverdue = texts.findLastIndex((text) => text.includes('Overdue'));
      const firstOnTime = texts.findIndex((text) => !text.includes('Overdue'));
      expect(firstOnTime === -1 || lastOverdue < firstOnTime, texts.join(' | ')).toBe(true);
    });
    await test.step('the overdue course opens from Home', async () => {
      await linkToCourse(section, late.id).click();
      await expect(eli).toHaveURL(courseUrl(late.id));
    });
  });
});
