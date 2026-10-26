/**
 * Checking a form response (Forms spec 3 "Submitting"; additions 8). The server runs it on every
 * submit and never trusts the browser; the fill screen runs it too for instant errors.
 */
import { DEFAULT_TIME_ZONE } from '../dates';
import { isRichTextEmpty } from '../richtext';
import { LIMITS } from '../types';
import type { FormDefinition, Id, Property, RichText } from '../types';
import { walkQuestions, type Respondent } from './logic';

/** The result of checking one answer: its stored value (null when empty), or why it can't be saved. */
export type AnswerCheck = { ok: true; value: unknown } | { ok: false; error: string };

export interface SubmissionOptions {
  /** Checks and normalizes one answer for its property, like validateValue in values.ts. */
  validate(prop: Property, value: unknown): AnswerCheck;
  /** The respondent's name, for "Response from Avery Lin". Never used for anonymous responses. */
  respondentName: string | null;
  /** True when the response must not record its sender (the form's setting, or set by the server). */
  anonymous: boolean;
  /**
   * The questions (property ids) the respondent's copy of the form had. A required question that
   * isn't among them means the form changed while they were filling it in.
   */
  seenQuestionIds?: readonly Id[];
  /** Time zone for date conditions and the person "Me" means; default America/Denver and nobody. */
  viewer?: Respondent;
}

export type SubmissionResult =
  | { ok: true; title: string; values: Record<Id, unknown> }
  | { ok: false; errors: Record<Id, string>; summary: string; formChanged: boolean };

const NOBODY: Respondent = { userId: '', timeZone: DEFAULT_TIME_ZONE };

const isSpanList = (v: unknown[]): v is RichText =>
  v.every((s) => typeof s === 'object' && s !== null && 'text' in s);

/** Empty answers are left out of the row: nothing, blank text, an empty list or an unticked box. */
function isBlank(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0 || (isSpanList(v) && isRichTextEmpty(v));
  return false;
}

function checkAnswer(prop: Property, raw: unknown, opts: SubmissionOptions): AnswerCheck {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const result = opts.validate(prop, raw);
  if (!result.ok) return result;
  if (isBlank(result.value)) return { ok: true, value: null };
  if (
    prop.config.type === 'files' &&
    Array.isArray(result.value) &&
    result.value.length > LIMITS.formFiles
  ) {
    return { ok: false, error: 'Up to 10 files.' };
  }
  return result;
}

/** The value a property gets when its question wasn't asked or answered: Status default, checkbox unticked. */
function defaultValue(prop: Property): unknown {
  const c = prop.config;
  if (c.type === 'checkbox') return false;
  if (c.type !== 'status') return undefined;
  const option =
    c.options.find((o) => o.id === c.defaultOptionId) ??
    c.options.find((o) => o.group === 'todo') ??
    c.options[0];
  return option?.id;
}

function responseTitle(opts: SubmissionOptions, anonymous: boolean): string {
  if (anonymous) return 'Anonymous response';
  const name = opts.respondentName?.trim();
  return name ? `Response from ${name}` : '';
}

/**
 * Checks a response and builds the new row. Answers to hidden or removed questions are dropped
 * (and never checked); visible answers go through `validate`; Required applies only to visible
 * questions ("Answer this question.", or "Tick this box to continue." for a checkbox); Files allow
 * up to 10. Properties that get no answer get their defaults (Status default, checkbox unticked).
 * The title is the Name answer, otherwise "Response from Avery Lin", or "Anonymous response".
 * Failing that, `errors` holds one message per question (keyed by property id) and `summary` the
 * line at the top ("2 questions need answers"). A required question missing from
 * `seenQuestionIds` sets `formChanged` ("This form changed. Please answer the new question.").
 */
export function checkSubmission(
  def: FormDefinition,
  properties: readonly Property[],
  answers: Readonly<Partial<Record<Id, unknown>>>,
  opts: SubmissionOptions,
): SubmissionResult {
  const anonymous = opts.anonymous || def.anonymous;
  const seen = opts.seenQuestionIds ? new Set(opts.seenQuestionIds) : null;
  const errors: Record<Id, string> = {};
  const values: Record<Id, unknown> = {};
  let title = '';
  let newRequired = 0;
  walkQuestions(def, properties, opts.viewer ?? NOBODY, anonymous, ({ question, prop, shown }) => {
    if (!shown) return null;
    const checked = checkAnswer(prop, answers[prop.id], opts);
    if (!checked.ok) {
      errors[prop.id] = checked.error;
      return null;
    }
    const value = checked.value;
    const answered = prop.config.type === 'checkbox' ? value === true : value !== null;
    if (question.required && !answered) {
      errors[prop.id] =
        prop.config.type === 'checkbox' ? 'Tick this box to continue.' : 'Answer this question.';
      if (seen && !seen.has(prop.id)) newRequired += 1;
      return null;
    }
    if (value === null) return null;
    if (prop.config.type === 'title') title = typeof value === 'string' ? value.trim() : '';
    else values[prop.id] = value;
    return value;
  });
  const count = Object.keys(errors).length;
  if (count > 0) {
    let summary = count === 1 ? '1 question needs an answer' : `${count} questions need answers`;
    if (newRequired === 1) summary = 'This form changed. Please answer the new question.';
    if (newRequired > 1) summary = 'This form changed. Please answer the new questions.';
    return { ok: false, errors, summary, formChanged: newRequired > 0 };
  }
  for (const prop of properties) {
    if (prop.config.type === 'title' || Object.hasOwn(values, prop.id)) continue;
    const value = defaultValue(prop);
    if (value !== undefined) values[prop.id] = value;
  }
  return { ok: true, title: title || responseTitle(opts, anonymous), values };
}

/** Where the fill screen keeps unsent answers in the browser: one draft per form and person. */
export function draftKey(formId: Id, userId: Id): string {
  return `carehub:form-draft:${formId}:${userId}`;
}
