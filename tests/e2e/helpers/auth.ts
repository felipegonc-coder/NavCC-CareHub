import type { Page } from '@playwright/test';
import { people, type PersonKey } from '../flows/_support/people.js';

const isPersonKey = (who: string): who is PersonKey => Object.hasOwn(people, who);

/**
 * Signs in on the sign-in screen as a seeded person: a role key such as 'editor', or the email of
 * someone a lane's seed added. The password is the seed's, from CAREHUB_SEED_PASSWORD. Ends on
 * the screen sign-in goes to (Home).
 */
export async function signInAs(page: Page, roleOrEmail: string): Promise<void> {
  const password = process.env.CAREHUB_SEED_PASSWORD;
  if (!password) throw new Error('Set CAREHUB_SEED_PASSWORD, the seed password, to sign in.');
  const email = isPersonKey(roleOrEmail) ? people[roleOrEmail].email : roleOrEmail;

  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  try {
    await page.waitForURL((url) => url.pathname !== '/sign-in', { timeout: 15_000 });
  } catch (error) {
    const alert = page.getByRole('main').getByRole('alert');
    const said = (await alert.count()) > 0 ? await alert.first().innerText() : 'no message';
    throw new Error(`Couldn't sign in as ${email}: ${said}`, { cause: error });
  }
}
