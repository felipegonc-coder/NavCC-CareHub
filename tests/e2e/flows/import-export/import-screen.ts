import type { APIResponse, Browser, Locator, Page, Request } from '@playwright/test';
import { apiFor, expect, signInAs, uniqueName, type PersonKey } from '../_support/index.js';
import type { FilePayload } from './zip-files.js';

// The Import screens of the Import and export spec (section 2), and the few API calls a test needs
// to make its own destination page and read back the page tree (docs/decisions/0007, 4.1). The
// page menu is found as in tests/e2e/flows/pages/page-screen.ts.

/** The body of a refused request (docs/decisions/0007, errors): no title, no content. */
export const FORBIDDEN = {
  error: { code: 'forbidden', message: "You don't have access to this." },
};

/** `text` with the characters a RegExp treats as special escaped. */
export const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The address of a page, /p/<id>, at the end of a link. */
export const pageHref = (id: string) => new RegExp(`/p/${id}$`);

/** A reply that is the thing itself or wraps it, such as { page: { … } }. */
function unwrap<T>(reply: unknown, ...keys: string[]): T {
  for (const key of keys) {
    if (typeof reply === 'object' && reply !== null && key in reply) {
      return (reply as Record<string, unknown>)[key] as T;
    }
  }
  return reply as T;
}

type Space = { id: string; name?: string; kind?: string; type?: string };

/** A new, empty fictional page in the team space "General", which every seeded person can open. */
export async function makeEmptyPage(page: Page, title = uniqueName('Fictional QA import')) {
  const api = await apiFor(page);
  const spaces = unwrap<Space[]>(await api.get('/api/spaces'), 'spaces');
  const space =
    spaces.find((s) => s.name === 'General') ??
    spaces.find((s) => s.kind === 'team' || s.type === 'team');
  if (!space) throw new Error('GET /api/spaces listed no team space.');
  const made = await api.post('/api/pages', { kind: 'page', title, spaceId: space.id });
  return { id: unwrap<{ id: string }>(made, 'page').id, title };
}

type TreeNode = { id: string; title: string; parentId?: string | null; children?: unknown };

/**
 * The pages under `rootId` in its space's tree, as title paths ("Escalations/Escalation steps")
 * to page IDs. It reads a nested tree or a flat list with parent IDs.
 */
export async function pagesUnder(page: Page, rootId: string): Promise<Map<string, string>> {
  const api = await apiFor(page);
  const root = unwrap<{ spaceId: string }>(await api.get(`/api/pages/${rootId}`), 'page');
  const reply = await api.get(`/api/spaces/${root.spaceId}/tree`);
  const nodes: TreeNode[] = [];
  const walk = (list: unknown, parentId: string | null) => {
    for (const node of Array.isArray(list) ? (list as TreeNode[]) : []) {
      nodes.push({ ...node, parentId: node.parentId ?? parentId });
      walk(node.children, node.id);
    }
  };
  walk(unwrap(reply, 'tree', 'pages', 'items'), null);
  const paths = new Map<string, string>();
  const add = (parentId: string, prefix: string) => {
    for (const node of nodes.filter((n) => n.parentId === parentId)) {
      paths.set(prefix + node.title, node.id);
      add(node.id, `${prefix}${node.title}/`);
    }
  };
  add(rootId, '');
  return paths;
}

/** Another seeded person in a browser of their own, signed in. Call `close()` at the end. */
export async function openAs(browser: Browser, who: PersonKey) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, who);
  return { page, close: () => context.close() };
}

/**
 * Sends a request the screens made again, as the person signed in on `page`: same address and
 * body, with that person's own CSRF token (the cookie gets a __Host- prefix over HTTPS, 0007 3.1).
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

/** A link in the page's content, by its text. */
export const link = (page: Page, name: string) =>
  page.getByRole('main').getByRole('link', { name });

/** A picture in the page's content that is shown and has loaded. */
export async function expectPicture(page: Page, name: string) {
  const picture = page.getByRole('main').getByRole('img', { name });
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

/** Import (section 2): the grid of sources, the file, then the progress panel and the summary. */
export class ImportScreen {
  readonly dialog: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /import/i });
  }

  /** Page menu → Import on the page `pageId`, so the import goes where it was opened from. */
  async openOn(pageId: string) {
    await this.page.goto(`/p/${pageId}`);
    await this.page
      .getByRole('banner')
      .getByRole('button', { name: /page menu|more/i })
      .click();
    await this.page.getByRole('menu').getByRole('menuitem', { name: 'Import' }).click();
    await expect(this.dialog).toBeVisible();
  }

  /** Chooses a source, such as "Notion export", then the file with "Choose a file". */
  async choose(source: string, file: FilePayload) {
    const name = new RegExp(`^${escaped(source)}`);
    await this.dialog
      .getByRole('button', { name })
      .or(this.dialog.getByRole('radio', { name }))
      .or(this.dialog.getByRole('option', { name }))
      .click();
    const chooser = this.page.waitForEvent('filechooser');
    await this.dialog.getByRole('button', { name: 'Choose a file' }).click();
    await (await chooser).setFiles(file);
  }

  /** The request that starts an import into `pageId`, once Import is pressed. */
  startRequest(pageId: string): Promise<Request> {
    const request = this.page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes('/api/import-export/') &&
        (request.url().includes(pageId) || (request.postDataBuffer()?.includes(pageId) ?? false)),
      { timeout: 60_000 },
    );
    request.catch(() => undefined);
    return request;
  }

  /** Presses Import and waits for the summary, "Imported … into <destination>." */
  async run(): Promise<Locator> {
    await this.dialog.getByRole('button', { name: 'Import', exact: true }).click();
    const summary = this.page.getByText(/^Imported \d/);
    await expect(summary).toBeVisible({ timeout: 60_000 });
    return summary;
  }

  /** A line of the summary's problem list (file, what happened, why) holding every one of `words`. */
  problem(...words: (string | RegExp)[]): Locator {
    return words.reduce(
      (line, word) => line.filter({ hasText: word }),
      this.page.getByRole('row').or(this.page.getByRole('listitem')),
    );
  }
}
