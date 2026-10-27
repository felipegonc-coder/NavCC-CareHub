// What the fill screen gets (Forms spec, sections 2 and 3): the form's words and settings, the
// questions it can ask (their property exists and can be a question for who can respond) in
// order, and those questions' properties. Nothing else about the database: no other properties,
// no rows, no link or closing settings, nobody's ids. Pure; routes.ts reads the database.
import type { FileRef, FormDefinition, FormQuestion, Property, RichText } from '@carehub/databases';
import {
  anonymousLine,
  formAudience,
  isAnonymousForm,
  questionLabel,
  walkQuestions,
  type FormAudience,
} from '@carehub/databases/forms';
import { hideMentionTitles, mentionedPageIds } from '../databases/meta';
import type { DatabaseRecord } from '../databases/record';
import type { FormView } from './links';

/** Until core files is on main, file questions take no uploads (a later forms PR adds them). */
export const FILES_UNAVAILABLE = "File uploads aren't available yet.";

export interface FillForm {
  /** The form's view id. */
  id: string;
  databaseId: string;
  /** The form's title, or the database's name. */
  title: string;
  description: RichText;
  /** `text` is the question's label (its text, or its property's name). */
  questions: Omit<FormQuestion, 'logicChanged'>[];
  properties: Omit<Property, 'access'>[];
  submitLabel: string;
  confirmation: RichText;
  allowMultiple: boolean;
  /** The response won't record who sent it. */
  anonymous: boolean;
  /** "Your name isn't recorded with this form.", or null. */
  anonymousLine: string | null;
  audience: FormAudience;
  cover: FileRef | null;
  icon: string | null;
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

/** The fill screen's form; `openable` holds the mentioned pages whose titles the person may see. */
export function fillForm(
  record: DatabaseRecord,
  view: FormView,
  openable: ReadonlySet<string>,
): FillForm {
  const form = withoutFileUploads(view.form, record.properties);
  const asked = askedQuestions(form, record.properties);
  const words = (text: RichText) => hideMentionTitles(text, openable);
  return {
    id: view.id,
    databaseId: record.id,
    title: form.title.trim() || record.title.trim() || 'Untitled',
    description: words(form.description),
    questions: asked.map(({ question, prop }) => ({
      propertyId: question.propertyId,
      text: questionLabel(question, prop),
      description: words(question.description),
      required: question.required,
      display: question.display,
      logic: question.logic,
    })),
    properties: asked.map(({ prop: { id, name, description, config, rowPage } }) => ({
      id,
      name,
      description,
      config,
      rowPage,
    })),
    submitLabel: form.submitLabel,
    confirmation: words(form.confirmation),
    allowMultiple: form.allowMultiple,
    anonymous: isAnonymousForm(form),
    anonymousLine: anonymousLine(form),
    audience: formAudience(form),
    cover: form.cover ?? null,
    icon: form.icon ?? null,
    uploads: { available: false, message: FILES_UNAVAILABLE },
  };
}
