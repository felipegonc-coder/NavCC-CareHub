import type { APIResponse, Locator, Page, Request } from '@playwright/test';
import { expect } from '../_support/index.js';

/**
 * Sends a request the screens made, such as Avery's change, again as the person signed in on
 * `page`, with that person's cookies and CSRF token: a direct request the screens never offer.
 */
export async function sendAgainAs(page: Page, request: Request): Promise<APIResponse> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name.endsWith('carehub_csrf'))?.value ?? '';
  const headers: Record<string, string> = {
    'X-CSRF-Token': csrf,
    Origin: new URL(request.url()).origin,
  };
  const type = request.headers()['content-type'];
  if (type) headers['Content-Type'] = type;
  const data = request.postDataBuffer() ?? undefined;
  return page.request.fetch(request.url(), { method: request.method(), headers, data });
}

/** The parts of Settings → Data (Data settings spec, section 2). */
export type Part =
  'Keeping data' | 'Storage' | 'Uploads' | 'Backups' | 'Export everything' | 'Delete workspace';

/** Picks a choice in a labelled control: a native select, or a field that opens a list. */
export async function choose(field: Locator, option: string): Promise<void> {
  if ((await field.evaluate((element) => element.tagName)) === 'SELECT') {
    await field.selectOption({ label: option });
  } else {
    await field.click();
    await field.page().getByRole('option', { name: option, exact: true }).click();
  }
}

/** The choice a labelled control shows now. */
export async function shownChoice(field: Locator): Promise<string> {
  if ((await field.evaluate((element) => element.tagName)) === 'SELECT') {
    return (await field.locator('option:checked').textContent()) ?? '';
  }
  return (await field.textContent()) ?? '';
}

/** Expects a labelled control to show a choice. */
export async function expectChoice(field: Locator, option: string): Promise<void> {
  if ((await field.evaluate((element) => element.tagName)) === 'SELECT') {
    await expect(field.locator('option:checked')).toHaveText(option);
  } else {
    await expect(field).toContainText(option);
  }
}

/**
 * Settings → Data at /settings/data (Admins): its parts are sections or tabs named Keeping data,
 * Storage, Uploads, Backups, Export everything and Delete workspace. Each change says "Saved",
 * and a change that deletes data asks first.
 */
export class DataSettings {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Opens Settings → Data. */
  async open(): Promise<void> {
    await this.page.goto('/settings/data');
    const first = { name: 'Keeping data', exact: true };
    await expect(
      this.page.getByRole('heading', first).or(this.page.getByRole('tab', first)).first(),
    ).toBeVisible();
  }

  /** Shows one part, a section or a tab panel by its name, picking its tab when there are tabs. */
  async show(name: Part): Promise<Locator> {
    const tab = this.page.getByRole('tab', { name, exact: true });
    if ((await tab.count()) > 0) await tab.click();
    const named = { name, exact: true };
    const part = this.page
      .getByRole('region', named)
      .or(this.page.getByRole('tabpanel', named))
      .first();
    await expect(part).toBeVisible();
    return part;
  }

  /** The confirm shown before a change that deletes data. */
  confirm(): Locator {
    return this.page.getByRole('alertdialog').or(this.page.getByRole('dialog')).first();
  }

  /** Waits for "Saved" after a change. */
  async saved(): Promise<void> {
    await expect(this.page.getByText('Saved', { exact: true }).first()).toBeVisible();
  }
}
