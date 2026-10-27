// Learning acceptance check: sharing a draft for review. From the Learning PRD (section 4.1,
// reviews) and docs/learning/api.md (review links: POST .../review-links answers { id, url } with
// the token in the url, shown once; GET /review takes it in the X-Review-Token header, decision
// 0309; DELETE /studio/review-links/:linkId stops sharing). Learning has no "Done means" list yet,
// so the ID is the Testing lane's (LN-xx).
import { apiFor, expect, needs, onlyIn, signInAs, test } from '../_support/index.js';
import { TARA, content, draftCourse, pageFor } from './course-data.js';
import { NOT_FOUND } from './learner-page.js';

type ReviewLink = { id: string; url: string };

test.describe('Learning: review links', () => {
  onlyIn('desktop-light');
  needs('signIn', 'learning', 'learningReview');

  test('LN-27 a review link shows the draft read-only to a signed-in reviewer, until it is stopped', async ({
    browser,
    page,
  }) => {
    const link = await test.step('Tara shares a draft course for review', async () => {
      await signInAs(page, TARA);
      const course = await draftCourse(page, [content('l1', 'Fictional QA draft lesson')]);
      const path = `/api/learning/studio/courses/${course.id}/review-links`;
      return (await apiFor(page)).post<ReviewLink>(path, {});
    });
    // api.md puts the token in the hash (/learning/review#<token>); routes.tsx has
    // learning/review/:token. Either way it is the hash, or else the last part of the path.
    const url = new URL(link.url, 'http://link.example.test');
    const token = url.hash.slice(1) || (url.pathname.split('/').pop() ?? '');
    const eliPage = await pageFor(browser, 'editor');
    const main = eliPage.getByRole('main');
    await test.step('Eli opens the link: the draft, with no way to edit or publish it', async () => {
      await eliPage.goto(link.url);
      await expect(main.getByText('Fictional QA draft lesson').first()).toBeVisible();
      await expect(main.getByRole('button', { name: 'Publish' })).toHaveCount(0);
      await expect(main.getByRole('button', { name: /add block/i })).toHaveCount(0);
      const review = await eliPage.request.get('/api/learning/review', {
        headers: { 'X-Review-Token': token },
      });
      expect(review.status()).toBe(200);
    });
    await test.step('once Tara stops sharing, the link no longer opens the draft', async () => {
      const stop = await (
        await apiFor(page)
      ).send('DELETE', `/api/learning/studio/review-links/${link.id}`);
      expect(stop.ok()).toBe(true);
      await eliPage.reload();
      await expect(eliPage.getByText(NOT_FOUND)).toBeVisible();
      await expect(main.getByText('Fictional QA draft lesson')).toHaveCount(0);
      const review = await eliPage.request.get('/api/learning/review', {
        headers: { 'X-Review-Token': token },
      });
      expect(review.ok()).toBe(false);
    });
  });
});
