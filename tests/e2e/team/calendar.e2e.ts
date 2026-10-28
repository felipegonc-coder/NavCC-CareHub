import {
  apiFor,
  expect,
  needs,
  onlyIn,
  signInAs,
  test,
  uniqueName,
} from '../flows/_support/index.js';

// Calendar smoke flow (Calendar spec v2, CA-02): Eli's own events show in Week, Day and Month.
// Fictional data only. Wednesday, November 18, 2026 is after the clock change: Denver is UTC-7.
const DATE = '2026-11-18';

test.describe('Calendar', () => {
  onlyIn('desktop-light');
  needs('signIn', 'calendar');

  test('events made through the API show in Week, Day and Month', async ({ page }) => {
    await signInAs(page, 'editor');
    const api = await apiFor(page);
    const title = uniqueName('Fictional care plan review');
    const allDayTitle = uniqueName('Fictional audit day');
    await api.post('/api/calendar/events', {
      title,
      allDay: false,
      start: '2026-11-18T17:00:00.000Z',
      end: '2026-11-18T18:00:00.000Z',
    });
    await api.post('/api/calendar/events', {
      title: allDayTitle,
      allDay: true,
      start: DATE,
      end: '2026-11-19',
    });

    const main = page.getByRole('main');
    const views = page.getByRole('group', { name: 'View' });
    const event = main.getByRole('button', {
      name: new RegExp(`^${title}, Wednesday, November 18, 10:00 to 11:00 AM`),
    });
    const allDay = main.getByRole('button', {
      name: new RegExp(`^${allDayTitle}, Wednesday, November 18, All day`),
    });

    await test.step('Week shows the event and the all-day event', async () => {
      await page.goto(`/calendar?date=${DATE}`);
      await expect(page).toHaveTitle('Care Hub · Calendar');
      await expect(views.getByRole('button', { name: 'Week' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(event).toBeVisible();
      await expect(allDay).toBeVisible();
    });

    await test.step('Day and Month show them too, with the view in the address', async () => {
      await views.getByRole('button', { name: 'Day' }).click();
      await expect(page).toHaveURL(/view=day/);
      await expect(event).toBeVisible();
      await views.getByRole('button', { name: 'Month' }).click();
      await expect(page).toHaveURL(/view=month/);
      await expect(page.getByText('November 2026', { exact: true })).toBeVisible();
      await expect(event).toBeVisible();
      await expect(allDay).toBeVisible();
    });

    await test.step('Next goes to December, without them', async () => {
      await page.getByRole('button', { name: 'Next month' }).click();
      await expect(page.getByText('December 2026', { exact: true })).toBeVisible();
      await expect(event).toHaveCount(0);
      await expect(allDay).toHaveCount(0);
    });
  });
});
