/**
 * Answers on the fill screen: what each question's control holds, turning that into the values the
 * form logic, the answer checks and the server take, and the draft kept in the browser until the
 * response is sent (Forms spec, Filling in).
 */
import type { FileRef, FormDefinition, FormQuestion, Id, Property } from '@carehub/databases';
import { isCalendarDate, zonedToInstant } from '@carehub/databases';
import {
  formAudience,
  questionKind,
  questionLabel,
  type QuestionKind,
} from '@carehub/databases/forms';
import { validateValue } from '@carehub/databases/values';
import type { FormAnswers } from './api';

/** What the controls hold, by question (property) id. Also what a draft keeps. */
export type Answers = Partial<Record<Id, unknown>>;

/** A person or row picked in a Person or Relation question, with the name it showed. */
export interface Picked {
  id: Id;
  label: string;
}

/** A date question's control: a start, an optional end, each with an optional time. */
export interface DateDraft {
  /** YYYY-MM-DD, or '' when empty. */
  start: string;
  /** HH:mm, used when hasTime. */
  startTime: string;
  hasEnd: boolean;
  end: string;
  endTime: string;
  hasTime: boolean;
}

export const EMPTY_DATE: DateDraft = {
  start: '',
  startTime: '',
  hasEnd: false,
  end: '',
  endTime: '',
  hasTime: false,
};

/** A question the form asks, with how it shows and the words it shows. */
export interface AskedQuestion {
  question: FormQuestion;
  prop: Property;
  kind: QuestionKind;
  label: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The questions the form asks, in order: those whose property exists and can be a question for
 * who can respond (no Person or Relation questions when anyone can fill it in), each property once.
 */
export function askedQuestions(
  def: FormDefinition,
  properties: readonly Property[],
): AskedQuestion[] {
  const audience = formAudience(def);
  const seen = new Set<Id>();
  const out: AskedQuestion[] = [];
  for (const question of def.questions) {
    const prop = properties.find((p) => p.id === question.propertyId);
    if (!prop || seen.has(prop.id)) continue;
    const kind = questionKind(prop, question, { audience });
    if (!kind) continue;
    seen.add(prop.id);
    out.push({ question, prop, kind, label: questionLabel(question, prop) });
  }
  return out;
}

// ---------------------------------------------------------------- reading control values

export const textOf = (v: unknown): string => str(v);

export const idsOf = (v: unknown): Id[] =>
  Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string') : [];

export const checkedOf = (v: unknown): boolean => v === true;

export function dateOf(v: unknown): DateDraft {
  if (!isRecord(v)) return EMPTY_DATE;
  return {
    start: str(v.start),
    startTime: str(v.startTime),
    hasEnd: v.hasEnd === true,
    end: str(v.end),
    endTime: str(v.endTime),
    hasTime: v.hasTime === true,
  };
}

export function pickedOf(v: unknown): Picked[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p: unknown) =>
    isRecord(p) && typeof p.id === 'string' ? [{ id: p.id, label: str(p.label) }] : [],
  );
}

export function filesOf(v: unknown): FileRef[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((f: unknown) =>
    isRecord(f) && typeof f.id === 'string' && typeof f.name === 'string'
      ? [
          {
            id: f.id,
            name: f.name,
            size: typeof f.size === 'number' ? f.size : 0,
            mime: str(f.mime),
            ...(typeof f.url === 'string' ? { url: f.url } : {}),
          },
        ]
      : [],
  );
}

// ---------------------------------------------------------------- to stored values

const TIME = /^(\d{1,2}):(\d{2})$/;

/** One end of a date answer: a CalendarDate, or with a time the Instant in the person's zone. */
function datePoint(date: string, time: string, hasTime: boolean, timeZone: string): string | null {
  if (!isCalendarDate(date)) return null;
  if (!hasTime) return date;
  const m = TIME.exec(time);
  const hour = m ? Number(m[1]) : 0;
  const minute = m ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  return zonedToInstant(date, hour, minute, timeZone);
}

/**
 * A date control as a date value, null when empty. A start or end that isn't a date is passed on
 * as it is, so the check says "Enter a date.".
 */
export function dateInput(d: DateDraft, timeZone: string): unknown {
  const end = d.hasEnd ? d.end : '';
  if (d.start === '' && end === '') return null;
  return {
    start: datePoint(d.start, d.startTime, d.hasTime, timeZone) ?? d.start,
    end: end === '' ? null : (datePoint(end, d.endTime, d.hasTime, timeZone) ?? end),
    hasTime: d.hasTime,
  };
}

/** What a control holds as the input validateValue takes for its property; null when empty. */
export function answerInput(kind: QuestionKind, raw: unknown, timeZone: string): unknown {
  switch (kind) {
    case 'short':
    case 'long':
    case 'number':
    case 'link':
    case 'email':
    case 'phone': {
      const text = str(raw);
      return text.trim() === '' ? null : text;
    }
    case 'radio':
    case 'dropdown':
      return str(raw) || null;
    case 'checkboxes':
    case 'multi_dropdown': {
      const ids = idsOf(raw);
      return ids.length > 0 ? ids : null;
    }
    case 'checkbox':
      return raw === true;
    case 'person':
    case 'relation': {
      const ids = pickedOf(raw).map((p) => p.id);
      return ids.length > 0 ? ids : null;
    }
    case 'files': {
      const files = filesOf(raw);
      return files.length > 0 ? files : null;
    }
    case 'date':
      return dateInput(dateOf(raw), timeZone);
  }
}

/** Every asked question's input, by property id (empty answers left out). */
export function answerInputs(
  asked: readonly AskedQuestion[],
  answers: Answers,
  timeZone: string,
): FormAnswers {
  const out: FormAnswers = {};
  for (const { prop, kind } of asked) {
    const input = answerInput(kind, answers[prop.id], timeZone);
    if (input !== null && input !== false) out[prop.id] = input;
  }
  return out;
}

/**
 * The stored values of the answers, for "Show if…" logic: an answer that doesn't pass its check
 * counts as empty.
 */
export function logicValues(asked: readonly AskedQuestion[], inputs: FormAnswers): FormAnswers {
  const out: FormAnswers = {};
  for (const { prop } of asked) {
    const input = inputs[prop.id];
    if (input === undefined) continue;
    const checked = validateValue(prop, input);
    if (checked.ok && checked.value !== null) out[prop.id] = checked.value;
  }
  return out;
}

/** The answers a response sends: only questions that show. */
export function responseAnswers(inputs: FormAnswers, shown: ReadonlySet<Id>): FormAnswers {
  return Object.fromEntries(Object.entries(inputs).filter(([id]) => shown.has(id)));
}

/** "1 new question: Reason for dispute", read out when answers show more questions. */
export function newQuestionsText(labels: readonly string[]): string {
  const n = labels.length;
  return `${n} new ${n === 1 ? 'question' : 'questions'}: ${labels.join(', ')}`;
}

/** "Uploading 2 files…" */
export function uploadingText(count: number): string {
  return `Uploading ${count} ${count === 1 ? 'file' : 'files'}…`;
}

// ---------------------------------------------------------------- drafts

function isEmptyAnswer(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isRecord(v)) {
    const d = dateOf(v);
    return d.start === '' && d.end === '';
  }
  return false;
}

/** True when nothing has been answered. */
export function isBlankAnswers(answers: Answers): boolean {
  return Object.values(answers).every(isEmptyAnswer);
}

/** The unsent answers kept under this key (see draftKey), if any. */
export function loadDraft(key: string): Answers | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && isRecord(parsed.answers) ? parsed.answers : null;
  } catch {
    return null;
  }
}

/** Keeps the answers until they're sent; nothing answered removes the draft. */
export function saveDraft(key: string, answers: Answers): void {
  try {
    if (isBlankAnswers(answers)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ answers }));
  } catch {
    // Storage is full or turned off: the answers stay on screen.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage is turned off: there is no draft to remove.
  }
}
