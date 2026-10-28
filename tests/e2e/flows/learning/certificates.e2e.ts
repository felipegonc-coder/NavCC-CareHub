// Learning acceptance check: certificates. From the Learning PRD (section 4.2, Certificates, and
// section 7, Phase 2 "Finished when": "Passing creates a certificate the agent can print, with a
// code that checks out"). Fields and code format: packages/learning/src/certificates/api.ts.
import { apiFor, expect, needs, onlyIn, shownDate, signInAs, test } from '../_support/index.js';
import { whoIs } from './assign-data.js';
import { TARA, liveCourse, pageFor, quiz, trueFalse } from './course-data.js';
import { PlayerPage } from './player-page.js';

// The browser is in Tokyo: Learning shows days in the profile's time zone (decision 0317).
test.use({ timezoneId: 'Asia/Tokyo' });

/** A verification code as issued: XXXX-XXXX-XXXX in Crockford base32. */
const CODE = /[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;
const GREET = 'You greet the caller first.';
type Found = { code: string; learnerName: string; courseTitle: string };

test.describe('Learning: certificates', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningQuizzes', 'certificates');

  test('LN-21 passing gives a printable certificate with the name, the date and a code that checks out', async ({
    browser,
    page,
  }) => {
    const course = await test.step('Tara publishes a quiz course with a certificate', async () => {
      await signInAs(page, TARA);
      const lessons = [quiz('l1', 'Fictional QA final quiz', [trueFalse('q1', GREET, true)])];
      return liveCourse(page, lessons, { settings: { certificate: { enabled: true } } });
    });
    const eli = new PlayerPage(await pageFor(browser, 'editor'));
    const me = await whoIs(eli.page);
    await test.step('Eli passes', async () => {
      await eli.start(course.id);
      await eli.startQuiz();
      await eli.answerTrueFalse(GREET, true);
      await eli.submit();
      await expect(eli.score(100)).toBeVisible();
    });
    const code =
      await test.step('Learning → Certificates: his name, the course, today and a code', async () => {
        await eli.page.goto('/learning/certificates');
        await eli.main.getByRole('link', { name: course.title }).click();
        await expect(eli.page).toHaveURL(/\/learning\/certificates\/[\w-]+$/);
        for (const text of [me.name, course.title, shownDate(new Date())]) {
          await expect(eli.main.getByText(text).first()).toBeVisible();
        }
        await expect(eli.main.getByRole('button', { name: /print|download/i })).toBeVisible();
        const shown = (await eli.main.getByText(CODE).first().textContent()) ?? '';
        expect(shown).toMatch(CODE);
        return shown.match(CODE)?.[0] ?? '';
      });
    await test.step('Tara looks the code up: it is Eli’s certificate for this course', async () => {
      const api = await apiFor(page);
      const found = await api.get<Found[]>(`/api/learning/certificates?code=${code}`);
      expect(found.map((it) => [it.code, it.learnerName, it.courseTitle])).toEqual([
        [code, me.name, course.title],
      ]);
    });
  });
});
