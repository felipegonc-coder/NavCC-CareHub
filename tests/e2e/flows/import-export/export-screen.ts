import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import type { Download, Locator, Page } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';
import { unzip } from './zip-files.js';

// The Export dialog of the Import and export spec (section 2) and what a test reads in the file
// it downloads. The page menu is found as in tests/e2e/flows/pages/page-screen.ts.

/** A new full-page database under `parentId` (docs/decisions/0200) with a row per title. */
export async function makeDatabaseIn(page: Page, parentId: string, title: string, rows: string[]) {
  const api = await apiFor(page);
  const reply = await api.post<{ id: string; database?: { id: string } }>('/api/databases', {
    parentId,
    inline: false,
    title,
  });
  const id = reply.database?.id ?? reply.id;
  for (const row of rows) await api.post(`/api/databases/${id}/rows`, { title: row });
  return id;
}

/** Export (page menu → Export): format, options, then Export. */
export class ExportScreen {
  readonly dialog: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /export/i });
  }

  async openOn(pageId: string) {
    await this.page.goto(`/p/${pageId}`);
    await this.page
      .getByRole('banner')
      .getByRole('button', { name: /page menu|more/i })
      .click();
    await this.page.getByRole('menu').getByRole('menuitem', { name: 'Export' }).click();
    await expect(this.dialog).toBeVisible();
  }

  /** An on/off option, such as "Include sub-pages". */
  option(name: string): Locator {
    return this.dialog
      .getByRole('checkbox', { name })
      .or(this.dialog.getByRole('switch', { name }));
  }

  /** Markdown and CSV, with Include sub-pages turned on; Include files and pictures is on. */
  async markdownWithSubPages() {
    const name = 'Markdown and CSV';
    await this.dialog
      .getByRole('radio', { name })
      .or(this.dialog.getByRole('option', { name }))
      .or(this.dialog.getByRole('button', { name }))
      .click();
    await this.option('Include sub-pages').check();
    await expect(this.option('Include files and pictures')).toBeChecked();
  }

  /** Presses Export and waits for the download (small exports download at once, section 3.3). */
  async download(): Promise<Download> {
    const download = this.page.waitForEvent('download', { timeout: 60_000 });
    await this.dialog.getByRole('button', { name: 'Export', exact: true }).click();
    return download;
  }
}

/** The files in a downloaded zip, by path. */
export async function filesIn(download: Download): Promise<Map<string, Buffer>> {
  return unzip(await readFile(await download.path()));
}

/** The one file called `name`, in whichever folder the export put it. */
export function pathOf(files: Map<string, Buffer>, name: string): string {
  const found = [...files.keys()].filter((path) => posix.basename(path) === name);
  expect(found, `files called ${name}`).toHaveLength(1);
  return found[0] ?? '';
}

/** The links and pictures in a Markdown file: [text](target) and ![text](target). */
export function linksIn(markdown: string) {
  return [...markdown.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g)].map(([, bang, text, to]) => ({
    picture: bang === '!',
    text: text ?? '',
    to: to ?? '',
  }));
}

/** The file a relative link in `from` leads to inside the export; null for web and app links. */
export function target(from: string, to: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(to) || to.startsWith('/') || to.startsWith('#')) return null;
  return posix.normalize(
    posix.join(posix.dirname(from), decodeURIComponent(to.split('#')[0] ?? '')),
  );
}
