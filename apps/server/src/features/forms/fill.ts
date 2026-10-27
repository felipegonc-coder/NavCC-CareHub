// What the fill screen gets (Forms spec, sections 2 and 3), in the shape the web's fill screen
// reads: the form's words and settings, the questions it can ask (their property exists and can be
// a question for who can respond) in order, and those questions' properties. Nothing else about
// the database: no other properties, no rows, no access lists, no link or closing settings, and
// not who gets notified. Pure; routes.ts reads the database.
import type {
  FileRef,
  FormDefinition,
  FormQuestion,
  Id,
  Property,
  RichText,
} from '@carehub/databases';
import {
  formAudience,
  isAnonymousForm,
  walkQuestions,
  type FormAudience,
  type FormGate,
  type Respondent,
} from '@carehub/databases/forms';
import { hideMentionTitles, mentionedPageIds } from '../databases/meta';
import type { DatabaseRecord } from '../databases/record';
import type { FormView } from './links';

/** Until core files is on main, file questions take no uploads (a later forms PR adds them). */
export const FILES_UNAVAILABLE = "File uploads aren't available yet.";

/** The form as its fill screen shows it: no link, closing settings or who gets notified. */
export type FillDefinition = Pick<
  FormDefinition,
  'title' | 'description' | 'submitLabel' | 'confirmation' | 'allowMultiple' | 'anonymous'
> & {
  questions: Omit<FormQuestion, 'logicChanged'>[];
  audience: FormAudience;
  cover: FileRef | null;
  icon: string | null;
};

/** A question's property: its name and settings (options, number format), not its access lists. */
export type FillProperty = Pick<Property, 'id' | 'name' | 'config'>;

/** What opening a form link answers. */
export interface FillScreen {
  /** The form's view id. */
  formId: Id;
  databaseId: Id;
  form: FillDefinition;
  /** The questions' properties. Unless the gate is open, there are no questions and none. */
  properties: FillProperty[];
  gate: FormGate;
  /** The person signed in, for "Me" in logic and dates in their time zone. */
  respondent: Respondent | null;
  /** Whether file questions take uploads, and what shows under them when they don't. */
  uploads: { available: boolean; message: string | null };
}

const NOBODY = { userId: '', timeZone: 'America/Denver' };

/** The questions the form can ask, in order, with their properties. */
export function askedQuestions(form: FormDefinition, properties: readonly Property[]) {
  const asked: { question: FormQuestion; prop: Property }[] = [];
  walkQuestions(form, properties, NOBODY, ({ question, prop }) => {
    asked.push({ question, prop });
    return null;
  });
  return asked;
}

/**
 * The form while uploads aren't available: file questions stay (conditions on them still work)
 * but aren't required, so the rest of the form can be sent.
 */
export function withoutFileUploads(
  form: FormDefinition,
  properties: readonly Property[],
): FormDefinition {
  const files = new Set(properties.filter((p) => p.config.type === 'files').map((p) => p.id));
  if (!form.questions.some((q) => q.required && files.has(q.propertyId))) return form;
  const questions = form.questions.map((q) =>
    files.has(q.propertyId) ? { ...q, required: false } : q,
  );
  return { ...form, questions };
}

/** Pages mentioned in the form's description, confirmation and question descriptions. */
export function formMentions(form: FormDefinition): string[] {
  const texts = [form.description, form.confirmation, ...form.questions.map((q) => q.description)];
  return [
    ...new Set(texts.flatMap((text) => mentionedPageIds({ description: text, templates: [] }))),
  ];
}

/**
 * The fill screen for this gate. `openable` holds the mentioned pages whose titles the person may
 * see. While the gate is closed, only the form's words go out: no questions, no properties.
 */
export function fillScreen(
  record: DatabaseRecord,
  view: FormView,
  visit: { gate: FormGate; respondent: Respondent | null; openable: ReadonlySet<string> },
): FillScreen {
  const form = withoutFileUploads(view.form, record.properties);
  const asked = visit.gate.state === 'open' ? askedQuestions(form, record.properties) : [];
  const words = (text: RichText) => hideMentionTitles(text, visit.openable);
  return {
    formId: view.id,
    databaseId: record.id,
    form: {
      title: form.title.trim() || record.title.trim() || 'Untitled',
      description: words(form.description),
      questions: asked.map(({ question }) => ({
        propertyId: question.propertyId,
        text: question.text,
        description: words(question.description),
        required: question.required,
        display: question.display,
        logic: question.logic,
      })),
      submitLabel: form.submitLabel,
      confirmation: words(form.confirmation),
      allowMultiple: form.allowMultiple,
      anonymous: isAnonymousForm(form),
      audience: formAudience(form),
      cover: form.cover ?? null,
      icon: form.icon ?? null,
    },
    properties: asked.map(({ prop: { id, name, config } }) => ({ id, name, config })),
    gate: visit.gate,
    respondent: visit.respondent,
    uploads: { available: false, message: FILES_UNAVAILABLE },
  };
}
