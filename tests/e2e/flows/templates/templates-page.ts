import type { Locator, Page } from '@playwright/test';
import { apiFor, expect } from '../_support/index.js';
import { updateView } from '../databases/database-api.js';
import type { DatabaseScreen } from '../databases/database-page.js';
import { PageScreen, literally, pageIdOf } from '../pages/page-screen.js';
import { choice } from '../sharing/share-dialog.js';
import { Sidebar } from '../sidebar/sidebar-page.js';

// Templates and buttons, sections 2 and 3: the template gallery, Save as template, a database's
// templates (New ▾ and "Start with") and the "/button" block. docs/extras/testing.md lists no
// Templates hooks yet, so these find the screens by role and by the names the spec uses. Every
// guess about the screens is in this file: lining the tests up with them is a change here alone.

/** Care Hub's own categories, after "Made in this workspace" (section 2). */
export const STARTER_CATEGORIES = 'Meetings Projects Knowledge Team Support Planning Forms'.split(
  ' ',
);

/** The gallery's category for the workspace's own templates. */
export const MADE_HERE = 'Made in this workspace';

/** The space a page is in, by its ID (GET /api/pages/:id). */
export async function spaceOfPage(page: Page, pageId: string): Promise<string> {
  type Reply = { spaceId?: string; page?: { spaceId?: string } };
  const reply = await (await apiFor(page)).get<Reply>(`/api/pages/${pageId}`);
  const spaceId = reply.page?.spaceId ?? reply.spaceId;
  if (!spaceId) throw new Error(`GET /api/pages/${pageId} answered without a space`);
  return spaceId;
}

/**
 * The template gallery (section 2), opened from Templates at the bottom of the sidebar. Assumed:
 * a dialog named "Templates"; categories on the left as tabs, buttons or links named exactly; each
 * card a button (or link) whose name starts with the template's name; the read-only preview the
 * topmost dialog with Use template, which shows the "Add to:" places as a list to pick from.
 */
export class TemplateGallery {
  readonly dialog: Locator;
  /** The gallery's own search box, focused when it opens (section 6). */
  readonly search: Locator;
  /** The read-only preview a card opens. */
  readonly preview: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /templates/i });
    this.search = this.dialog
      .getByRole('searchbox')
      .or(this.dialog.getByRole('textbox', { name: /search/i }))
      .first();
    this.preview = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Use template' }) })
      .last();
  }

  /** Templates at the bottom of the sidebar (Sidebar, section 2). */
  async open() {
    const nav = new Sidebar(this.page).nav;
    const named = { name: 'Templates', exact: true };
    await nav.getByRole('button', named).or(nav.getByRole('link', named)).first().click();
    await expect(this.dialog).toBeVisible();
  }

  /** A category on the left, such as "Meetings". */
  category(name: string): Locator {
    const named = { name, exact: true };
    return this.dialog
      .getByRole('tab', named)
      .or(this.dialog.getByRole('button', named))
      .or(this.dialog.getByRole('link', named))
      .first();
  }

  /** A template's card: name, one-line description and "by Care Hub" or "by <person>". */
  card(name: string): Locator {
    const named = { name: new RegExp(`^${literally(name).source}`) };
    return this.dialog.getByRole('button', named).or(this.dialog.getByRole('link', named)).first();
  }

  /** Clicks a card and waits for its preview. */
  async previewOf(name: string): Promise<Locator> {
    await this.card(name).click();
    await expect(this.preview).toBeVisible();
    return this.preview;
  }

  /** Use template → "Add to:" a place, such as Private. The copy opens; returns its page ID. */
  async use(place: string): Promise<string> {
    await this.preview.getByRole('button', { name: 'Use template' }).click();
    await expect(this.page.getByText(/^Add to:?$/)).toBeVisible();
    await choice(this.page, place).click();
    await expect(this.dialog).toBeHidden();
    await expect(this.page).toHaveURL(/\/p\/[^/?#]+/);
    await expect(new PageScreen(this.page).title).toBeVisible();
    return pageIdOf(this.page);
  }
}

/**
 * Page menu → Save as template (section 2): name, description, category, who can use it and
 * "Include sub-pages" (on by default), then Save. Assumed: a dialog named "Save as template".
 */
export class SaveAsTemplate {
  readonly dialog: Locator;
  readonly name: Locator;
  readonly includeSubPages: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /save as template/i });
    this.name = this.dialog.getByRole('textbox', { name: /^name/i });
    const subPages = { name: /include sub-pages/i };
    this.includeSubPages = this.dialog
      .getByRole('checkbox', subPages)
      .or(this.dialog.getByRole('switch', subPages))
      .first();
  }

  async open() {
    const menu = await new PageScreen(this.page).openPageMenu();
    await menu.getByRole('menuitem', { name: /^save as template/i }).click();
    await expect(this.dialog).toBeVisible();
  }

  async save() {
    await this.dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(this.dialog).toBeHidden();
  }
}

/** A database template as the API returns it (RowTemplate in packages/databases/src/types.ts). */
export type RowTemplate = { id: string; name: string };

type Settings = { version?: number; templates?: RowTemplate[] };

/** A settings reply: the database itself, or the database wrapped as { database }. */
type SettingsReply = Settings & { database?: Settings };

/** The database's settings version, which every settings write sends (decision 0200). */
async function versionOf(page: Page, databaseId: string): Promise<number | undefined> {
  const reply = await (await apiFor(page)).get<SettingsReply>(`/api/databases/${databaseId}`);
  return (reply.database ?? reply).version;
}

/** Adds a template for new rows, with preset values by property ID (POST /:id/templates). */
export async function addRowTemplate(
  page: Page,
  databaseId: string,
  name: string,
  values: Record<string, unknown>,
): Promise<RowTemplate> {
  const version = await versionOf(page, databaseId);
  const reply = await (
    await apiFor(page)
  ).post<SettingsReply & Partial<RowTemplate>>(`/api/databases/${databaseId}/templates`, {
    version,
    name,
    icon: null,
    values,
  });
  // A settings write answers with the whole database; the template alone would do as well.
  const templates = reply.database?.templates ?? reply.templates;
  const made = templates ? templates.find((template) => template.name === name) : reply;
  if (!made?.id) throw new Error(`No template "${name}" in ${JSON.stringify(reply)}`);
  return { id: made.id, name };
}

/** The database's own default template for New (PATCH /:id { version, defaultTemplateId }). */
export async function setDatabaseDefault(page: Page, databaseId: string, templateId: string) {
  const version = await versionOf(page, databaseId);
  await (
    await apiFor(page)
  ).patch(`/api/databases/${databaseId}`, {
    version,
    defaultTemplateId: templateId,
  });
}

/** A view's own default template for New (View.defaultTemplateId), ahead of the database's. */
export async function setViewDefault(
  page: Page,
  databaseId: string,
  viewId: string,
  templateId: string,
) {
  const version = await versionOf(page, databaseId);
  await updateView(page, databaseId, viewId, { version, defaultTemplateId: templateId });
}

/**
 * New ▾ of a database (Databases additions, section 6): the templates in order, the default marked
 * "Default", then Empty and + New template. Assumed: the ▾ is a button named for templates or by
 * the arrow, and the list is a menu of menu items.
 */
export class NewRowMenu {
  readonly opener: Locator;
  readonly menu: Locator;
  readonly empty: Locator;

  constructor(readonly screen: DatabaseScreen) {
    this.opener = screen.root.getByRole('button', { name: /template|▾/i });
    this.menu = screen.page.getByRole('menu');
    this.empty = this.menu.getByRole('menuitem', { name: 'Empty', exact: true });
  }

  async open(): Promise<Locator> {
    await this.opener.click();
    await expect(this.menu).toBeVisible();
    return this.menu;
  }

  /** A template's entry, by its name. */
  item(name: string | RegExp): Locator {
    return this.menu.getByRole('menuitem', {
      name: typeof name === 'string' ? literally(name) : name,
    });
  }
}

/**
 * Does what adds a row (New, or a pick in New ▾) and waits for one more row in the table. A row
 * page that opens for the new row is closed again with Esc, so the table shows.
 */
export async function addRowBy(screen: DatabaseScreen, adding: () => Promise<void>) {
  const before = await screen.rows().count();
  await adding();
  const rowPage = screen.page.getByRole('dialog');
  await expect(rowPage.or(screen.rows().nth(before)).first()).toBeVisible();
  if (await rowPage.isVisible()) {
    await screen.page.keyboard.press('Escape');
    await expect(rowPage).toBeHidden();
  }
  await expect(screen.rows()).toHaveCount(before + 1);
}

/** The actions a button block can run (section 3.4), by their names in Add action. */
export type ButtonAction = 'Insert blocks' | 'Add a row' | 'Open a page';

/**
 * The settings of a button block (section 2): label, the actions in order and the plain sentence
 * under them, "When pressed: …". Assumed: "/button" opens them at once, as a dialog with Add
 * action; each action is a group named after it, its pickers comboboxes named "Database", "Page"
 * and "Open in"; Done closes the settings.
 */
export class ButtonSettings {
  readonly dialog: Locator;
  readonly label: Locator;
  readonly sentence: Locator;

  constructor(readonly page: Page) {
    this.dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Add action' }) });
    this.label = this.dialog.getByRole('textbox', { name: /^label/i });
    this.sentence = this.dialog.getByText(/^When pressed:/);
  }

  /** Add action → an action. Returns that action's part of the settings. */
  async addAction(action: ButtonAction): Promise<Locator> {
    await this.dialog.getByRole('button', { name: 'Add action' }).click();
    await choice(this.page, action).click();
    const step = this.dialog.getByRole('group', { name: literally(action) }).last();
    await expect(step).toBeVisible();
    return step;
  }

  /** Picks a value in one of an action's pickers, such as its database. */
  async choose(step: Locator, picker: RegExp, value: string | RegExp) {
    await step.getByRole('combobox', { name: picker }).click();
    await choice(this.page, value).click();
  }

  async done() {
    await this.dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(this.dialog).toBeHidden();
  }
}

/** Undo in the "Done · Undo" note a button shows for 8 seconds after a run that changed things. */
export function undoOf(page: Page): Locator {
  return page.getByRole('button', { name: 'Undo', exact: true });
}
