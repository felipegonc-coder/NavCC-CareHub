import { randomUUID } from 'node:crypto';
import type { APIResponse, Page } from '@playwright/test';
import { apiFor, uniqueName } from '../_support/index.js';
import {
  addView,
  getDatabase,
  updateView,
  type Database,
  type View,
} from '../databases/database-api.js';

// A form is a database's Form view (FormDefinition in packages/databases/src/types.ts). Tests make
// the view through the API, then save its questions by reading the whole form back, changing it
// and writing it all, so every setting the server expects is still there.

type Condition = { id: string; questionPropertyId: string; op: string; value?: unknown };

/** "Show this question only when…": All (and) or Any (or) of its conditions. */
export type Logic = { combinator: 'and' | 'or'; conditions: Condition[] };

/** One question: its property, text, Required, display style and logic. */
export type Question = {
  propertyId: string;
  text: string;
  description: unknown[];
  required: boolean;
  display: 'default' | 'long' | 'dropdown';
  logic: Logic | null;
};

/** The settings these tests read; the others are kept as the server has them. */
export type Form = {
  title: string;
  questions: Question[];
  allowMultiple: boolean;
  accepting: boolean;
  linkCode: string;
} & Record<string, unknown>;

export type FormView = View & { form: Form };

/** A question for a property, such as question(notes.id, 'What happened?', { required: true }). */
export function question(propertyId: string, text: string, more: Partial<Question> = {}): Question {
  return {
    propertyId,
    text,
    description: [],
    required: false,
    display: 'default',
    logic: null,
    ...more,
  };
}

/** A condition on an earlier question, such as when(category.id, 'is_any_of', [billingId]). */
export function when(questionPropertyId: string, op: string, value?: unknown): Condition {
  return { id: randomUUID(), questionPropertyId, op, ...(value === undefined ? {} : { value }) };
}

/** Logic that shows a question when all, or any, of the conditions hold. */
export const showIf = {
  all: (...conditions: Condition[]): Logic => ({ combinator: 'and', conditions }),
  any: (...conditions: Condition[]): Logic => ({ combinator: 'or', conditions }),
};

/** The database's first Form view. */
export function formViewOf(database: Database): FormView {
  const view = database.views.find((v) => v.layout === 'form');
  if (!view) throw new Error(`${database.title} has no Form view.`);
  return view as FormView;
}

/** A Form view as the server has it now. */
export async function getFormView(
  page: Page,
  databaseId: string,
  viewId: string,
): Promise<FormView> {
  const database = await getDatabase(page, databaseId);
  const view = database.views.find((v) => v.id === viewId);
  if (!view) throw new Error(`${database.title} has no view ${viewId}.`);
  return view as FormView;
}

/** Changes some of a form's settings and keeps the rest; resolves with the saved view. */
export async function updateForm(
  page: Page,
  databaseId: string,
  viewId: string,
  changes: Partial<Form>,
): Promise<FormView> {
  const { form } = await getFormView(page, databaseId, viewId);
  await updateView(page, databaseId, viewId, { form: { ...form, ...changes } });
  return getFormView(page, databaseId, viewId);
}

/**
 * Adds a Form view that accepts responses with these questions. It takes more than one response
 * per person, so a test can send a second one by hand, unless the settings say otherwise.
 */
export async function makeForm(
  page: Page,
  database: Database,
  questions: Question[],
  settings: Partial<Form> = {},
): Promise<FormView> {
  const view = await addView(page, database.id, uniqueName('Fictional QA form'), 'form');
  const form = { accepting: true, allowMultiple: true, ...settings, questions };
  return updateForm(page, database.id, view.id, form);
}

/** The title the fill screen shows: the form's own, or else the database's name. */
export function formTitle(database: Database, view: FormView): string {
  return view.form.title || database.title;
}

/** Share form → Change link, through the API; resolves with the new link code. */
export async function changeLink(page: Page, databaseId: string, viewId: string): Promise<string> {
  await (await apiFor(page)).post(`/api/forms/${databaseId}/views/${viewId}/link`);
  return (await getFormView(page, databaseId, viewId)).form.linkCode;
}

/** A hand-made request: answers by property id, sent straight to the server. */
export async function sendAnswers(
  page: Page,
  linkCode: string,
  answers: Record<string, unknown>,
): Promise<APIResponse> {
  return (await apiFor(page)).send('POST', `/api/forms/${linkCode}/responses`, { answers });
}
