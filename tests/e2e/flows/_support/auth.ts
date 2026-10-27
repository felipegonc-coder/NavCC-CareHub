import type { Page } from '@playwright/test';
import type { PersonKey } from './people.js';

type CoreAuth = { signInAs: (page: Page, roleOrEmail: string) => Promise<void> };

/**
 * Signs in as a seeded person (a role key such as 'editor', or an email) through the core helper in
 * tests/e2e/helpers/auth.ts, which arrives with the sign-in screens. The path is a variable so this
 * file type-checks before that helper exists; tests that sign in call needs('signIn') first.
 */
export async function signInAs(page: Page, who: PersonKey | `${string}@${string}`): Promise<void> {
  const helper = '../../helpers/auth.js';
  const core = (await import(helper)) as CoreAuth;
  await core.signInAs(page, who);
}
