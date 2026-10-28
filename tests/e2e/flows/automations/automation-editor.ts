import type { Locator, Page, Request } from '@playwright/test';
import { expect } from '../_support/index.js';
import { containing, type DatabaseScreen } from '../databases/database-page.js';

/** ⚡ in a database's toolbar (Admins only), by its symbol or its name. */
const LIGHTNING = /^(⚡|Automations)/;

/** The Schedule field that says how often it runs (Once, Every day, Every weekday…). */
const REPEAT = /^(Repeat|Repeats|Runs|How often|Frequency)$/;

/** The Property changed fields: the property to watch, and the value it changes to. */
const WATCH = /^(Property|Properties|Watch|Property to watch)$/;
const CHANGES_TO = /^(To|Changes to)$/;

/** The two ways to try an automation (section 3, Try it now). */
export type TryChoice = 'Send only to me' | 'Send to everyone now';

/** A quarter hour as the screens show it, such as "9:00 AM", in 24-hour form ("09:00"). */
function twentyFourHour(shown: string): string {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(shown);
  if (!match) throw new Error(`"${shown}" isn't a time like 9:00 AM.`);
  const [, hours = '', minutes = '', half] = match;
  const hour = (Number(hours) % 12) + (half === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${minutes}`;
}

/**
 * The automation editor (Automations spec section 2), an ordinary form: Name, Trigger and its
 * settings, actions in order (Add action), Save, Try it now, Delete and Run history, under a
 * sentence that reads the automation back in plain words. Fields are found by their labels; a
 * choice may be a native select, radio buttons or a list of options that the field opens.
 */
export class AutomationEditor {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** ⚡ in a database's toolbar → New automation: the editor, with the database filled in. */
  static async newFor(screen: DatabaseScreen): Promise<AutomationEditor> {
    await AutomationEditor.fromToolbar(screen, 'New automation');
    const editor = new AutomationEditor(screen.page);
    await expect(editor.name()).toBeVisible();
    return editor;
  }

  /** ⚡ in a database's toolbar → one of the automations that use the database. */
  static async openFor(screen: DatabaseScreen, name: string): Promise<AutomationEditor> {
    await AutomationEditor.fromToolbar(screen, name);
    const editor = new AutomationEditor(screen.page);
    await expect(editor.name()).toHaveValue(name);
    return editor;
  }

  private static async fromToolbar(screen: DatabaseScreen, item: string): Promise<void> {
    await screen.root.getByRole('button', { name: LIGHTNING }).click();
    const named = { name: item, exact: true };
    await screen.page
      .getByRole('menuitem', named)
      .or(screen.page.getByRole('link', named))
      .or(screen.page.getByRole('button', named))
      .first()
      .click();
  }

  /** The automation's name. */
  name(): Locator {
    return this.page.getByRole('textbox', { name: 'Name', exact: true });
  }

  /** The sentence at the top that reads the automation back, such as "When Status changes…". */
  readback(): Locator {
    return this.page.getByText(/^When\b/).first();
  }

  /** Picks an option in a field, by its label: the last such field, as new actions come last. */
  async pick(label: string | RegExp, option: string): Promise<void> {
    const field = (
      typeof label === 'string'
        ? this.page.getByLabel(label, { exact: true })
        : this.page.getByLabel(label)
    ).last();
    const radio = field.getByRole('radio', { name: option, exact: true });
    if ((await field.evaluate((element) => element.tagName)) === 'SELECT') {
      await field.selectOption({ label: option });
    } else if ((await radio.count()) > 0) {
      await radio.check();
    } else {
      await field.click();
      await this.page.getByRole('option', { name: option, exact: true }).click();
    }
  }

  /** Schedule → how often it runs, such as "Every weekday": radio buttons or a field to pick in. */
  async repeat(kind: string): Promise<void> {
    const radio = this.page.getByRole('radio', { name: kind, exact: true });
    await expect(radio.or(this.page.getByLabel(REPEAT)).first()).toBeVisible();
    if ((await radio.count()) > 0) await radio.check();
    else await this.pick(REPEAT, kind);
  }

  /** Schedule → its time, a quarter hour such as "9:00 AM": a time box or a list of times. */
  async time(shown: string): Promise<void> {
    const field = this.page.getByLabel('Time', { exact: true }).last();
    if ((await field.getAttribute('type')) === 'time') await field.fill(twentyFourHour(shown));
    else await this.pick('Time', shown);
  }

  /** Property changed → the property to watch and, if given, the value it has to change to. */
  async watch(property: string, to?: string): Promise<void> {
    await this.pick(WATCH, property);
    if (to !== undefined) await this.pick(CHANGES_TO, to);
  }

  /** A setting that is on or off, such as "Include imports": a checkbox or a switch. */
  option(name: string): Locator {
    const named = { name, exact: true };
    return this.page.getByRole('checkbox', named).or(this.page.getByRole('switch', named)).first();
  }

  /** Add action → an action, such as "Edit the row". */
  async addAction(action: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Add action', exact: true }).click();
    await this.page.getByRole('menuitem', { name: action, exact: true }).click();
  }

  /**
   * Send a message → its recipients field (people, roles, everyone, or the people in a Person
   * property of the row) → the choice with this name: one that holds the text, or matches the
   * pattern, such as a property's or a person's name.
   */
  async sendTo(recipient: string | RegExp): Promise<void> {
    await this.page
      .getByLabel(/^(To|Send to|Recipients)$/)
      .last()
      .click();
    await this.page
      .getByRole('option', {
        name: typeof recipient === 'string' ? containing(recipient) : recipient,
      })
      .first()
      .click();
  }

  /** The text box of the last Send a message action. */
  message(): Locator {
    return this.page.getByRole('textbox', { name: 'Message', exact: true }).last();
  }

  /** Presses Save, waits for the server to take the automation, and gives back the request. */
  async save(): Promise<Request> {
    const saved = this.page.waitForResponse(
      (response) => response.url().includes('/api/') && response.request().method() !== 'GET',
    );
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    return response.request();
  }

  /**
   * Try it now → "Send only to me" (the default, marked Test) or "Send to everyone now": a menu
   * item or a button, or a choice in a dialog that then sends with its own button.
   */
  async tryItNow(choice: TryChoice): Promise<void> {
    await this.page.getByRole('button', { name: 'Try it now', exact: true }).click();
    const named = { name: choice, exact: true };
    const radio = this.page.getByRole('radio', named);
    const item = this.page.getByRole('menuitem', named).or(this.page.getByRole('button', named));
    await expect(radio.or(item).first()).toBeVisible();
    if ((await radio.count()) === 0) {
      await item.first().click();
      return;
    }
    await radio.check();
    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: /^(Send|Run|Try it now)\b/ })
      .last()
      .click();
  }

  /** Opens Run history, a tab or a button of the editor. */
  async runHistory(): Promise<void> {
    const named = { name: 'Run history', exact: true };
    await this.page
      .getByRole('tab', named)
      .or(this.page.getByRole('button', named))
      .first()
      .click();
  }
}
