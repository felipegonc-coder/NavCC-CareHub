import type { Locator, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import type { DatabaseScreen } from '../databases/database-page.js';

/** The "+" by a database's view tabs. */
const ADD_VIEW = /^(\+|Add view|Add a view|New view)$/;

/**
 * The fill screen at /forms/<link code> (Forms spec section 2): a form named after its title,
 * each question labelled by its text (a Select with up to 7 options as radio buttons, a Checkbox
 * as one tick box), Submit, and the confirmation as a status message.
 */
export class FormFill {
  readonly page: Page;
  readonly form: Locator;

  constructor(page: Page, title: string) {
    this.page = page;
    this.form = page.getByRole('form', { name: title });
  }

  /** Opens a form's link and waits for its questions. */
  async open(linkCode: string): Promise<void> {
    await this.page.goto(`/forms/${linkCode}`);
    await expect(this.form).toBeVisible();
  }

  /** A short or long answer box, by question text. */
  box(question: string): Locator {
    return this.form.getByRole('textbox', { name: question });
  }

  /** A Checkbox question's tick box, by question text. */
  tickBox(question: string): Locator {
    return this.form.getByRole('checkbox', { name: question });
  }

  /** A Select question's radio buttons, by question text. */
  choices(question: string): Locator {
    return this.form
      .getByRole('radiogroup', { name: question })
      .or(this.form.getByRole('group', { name: question }));
  }

  /** Types the answer to a text question. */
  async answer(question: string, text: string): Promise<void> {
    await this.box(question).fill(text);
  }

  /** Picks one of a Select question's radio buttons. */
  async choose(question: string, option: string): Promise<void> {
    await this.choices(question).getByRole('radio', { name: option, exact: true }).check();
  }

  /** Presses Submit. */
  async submit(): Promise<void> {
    await this.form.getByRole('button', { name: 'Submit', exact: true }).click();
  }

  /** Presses Submit, then waits for the server to take the response and the confirmation. */
  async send(): Promise<void> {
    const sent = this.page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/responses'),
    );
    await this.submit();
    expect((await sent).ok()).toBe(true);
    await expect(this.confirmation()).toBeVisible();
  }

  /** The confirmation message once a response is sent. */
  confirmation(): Locator {
    return this.page.getByRole('status').filter({ hasText: /\w/ }).first();
  }

  /** Errors under questions that say this, such as "Answer this question.". */
  errors(text: string): Locator {
    return this.form.getByText(text, { exact: true });
  }
}

/**
 * The builder: a database's Form view, for people who can edit it. "+ Add question" lists the
 * unused properties and New question (then a property type); an empty form lists the properties.
 */
export class FormBuilder {
  readonly screen: DatabaseScreen;

  constructor(screen: DatabaseScreen) {
    this.screen = screen;
  }

  /** "+" by the view tabs → Form; the new Form tab is selected. */
  async addFormView(): Promise<void> {
    await this.screen.root.getByRole('button', { name: ADD_VIEW }).click();
    await this.screen.page.getByRole('menuitem', { name: 'Form', exact: true }).click();
    await expect(this.screen.tab('Form')).toHaveAttribute('aria-selected', 'true');
  }

  /** What a form without questions shows. */
  emptyState(): Locator {
    return this.screen.root.getByText('Add your first question.');
  }

  /** Adds a question for an unused property, such as "Priority". */
  async addQuestion(property: string): Promise<void> {
    const named = { name: property, exact: true };
    if (await this.emptyState().isVisible()) {
      await this.screen.root.getByRole('button', named).click();
      return;
    }
    await this.addButton().click();
    await this.screen.page.getByRole('menuitem', named).click();
  }

  /** "+ Add question" → New question → a property type, then types the question's text. */
  async newQuestion(type: string, text: string): Promise<void> {
    await this.addButton().click();
    await this.screen.page.getByRole('menuitem', { name: /New question/ }).click();
    await this.screen.page.getByRole('menuitem', { name: type, exact: true }).click();
    const editor = this.screen.page.locator(':focus');
    await expect(editor).toBeEditable();
    await editor.fill(text);
    await editor.press('Tab');
  }

  private addButton(): Locator {
    return this.screen.root.getByRole('button', { name: /Add question/ });
  }
}
