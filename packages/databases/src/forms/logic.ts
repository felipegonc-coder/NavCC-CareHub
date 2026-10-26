/**
 * "Show if…" logic for forms (Forms spec 3): which questions show for the answers so far, moving
 * questions without breaking a dependency, and cleaning up conditions after a property, option or
 * question goes away.
 */
import { dateValueStartDay, isValidDateValue } from '../dates';
import { compareDecimal, normalizeDecimal, numberToDecimal } from '../decimal';
import { plainText } from '../richtext';
import { findProperty } from '../row';
import { textEquals, textIncludes } from '../text';
import { ME } from '../types';
import type {
  FormCondition,
  FormConditionOp,
  FormDefinition,
  FormQuestion,
  Id,
  Property,
  RichTextSpan,
  Viewer,
} from '../types';
import { conditionProblem, isConditionSet, questionKind, questionLabel } from './questions';

/** Who is answering: their time zone (for date conditions) and their id ("Me" in person conditions). */
export type Respondent = Pick<Viewer, 'userId' | 'timeZone'>;

/** One step of walkQuestions. */
export interface QuestionStep {
  question: FormQuestion;
  prop: Property;
  /** Whether its "Show if…" logic matches the answers above it. */
  shown: boolean;
}

/** What each condition gives when its question is empty (or hidden, or no longer in the form). */
const WHEN_EMPTY: Record<FormConditionOp, boolean> = {
  is: false,
  is_not: true,
  contains: false,
  does_not_contain: true,
  eq: false,
  neq: true,
  gt: false,
  lt: false,
  gte: false,
  lte: false,
  is_any_of: false,
  is_none_of: true,
  contains_any: false,
  contains_all: false,
  contains_none: true,
  is_checked: false,
  is_not_checked: true,
  before: false,
  after: false,
  is_empty: true,
  is_not_empty: false,
};

const isSpan = (x: unknown): x is RichTextSpan =>
  typeof x === 'object' && x !== null && typeof (x as { text?: unknown }).text === 'string';

/**
 * An answer as conditions compare it, or null when it's empty: trimmed text, an exact decimal,
 * an option id, a list of ids, the start day of a date (in the respondent's time zone), or true
 * for a ticked box or attached files.
 */
function comparable(prop: Property, raw: unknown, timeZone: string): string | Id[] | true | null {
  switch (prop.config.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone': {
      const text =
        typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? plainText((raw as unknown[]).filter(isSpan))
            : '';
      return text.trim() || null;
    }
    case 'number':
      if (typeof raw === 'number') return numberToDecimal(raw);
      return typeof raw === 'string' ? normalizeDecimal(raw) : null;
    case 'select':
      return typeof raw === 'string' && raw !== '' ? raw : null;
    case 'multi_select':
    case 'person':
    case 'relation': {
      const ids = Array.isArray(raw)
        ? (raw as unknown[]).filter((x): x is Id => typeof x === 'string' && x !== '')
        : [];
      return ids.length ? ids : null;
    }
    case 'date':
      return isValidDateValue(raw) ? dateValueStartDay(raw, timeZone) : null;
    case 'checkbox':
      return raw === true ? true : null;
    case 'files':
      return Array.isArray(raw) && raw.length > 0 ? true : null;
    default:
      return null;
  }
}

function compares(op: FormConditionOp, order: -1 | 0 | 1): boolean {
  switch (op) {
    case 'eq':
      return order === 0;
    case 'neq':
      return order !== 0;
    case 'gt':
      return order > 0;
    case 'lt':
      return order < 0;
    case 'gte':
      return order >= 0;
    default:
      return order <= 0;
  }
}

/**
 * Whether one condition matches an earlier question's answer. Text compares ignoring case and
 * accents; numbers compare exactly; dates use their start day.
 */
function conditionMatches(
  cond: FormCondition,
  source: Property,
  raw: unknown,
  respondent: Respondent,
): boolean {
  const a = comparable(source, raw, respondent.timeZone);
  if (a === null) return WHEN_EMPTY[cond.op];
  const v: unknown = cond.value;
  switch (cond.op) {
    case 'is_empty':
      return false;
    case 'is_not_empty':
      return true;
    case 'is_checked':
      return a === true;
    case 'is_not_checked':
      return a !== true;
    case 'is':
    case 'is_not': {
      const same =
        typeof a === 'string' &&
        typeof v === 'string' &&
        (source.config.type === 'date' ? a === v : textEquals(a, v.trim()));
      return cond.op === 'is' ? same : !same;
    }
    case 'contains':
    case 'does_not_contain': {
      const has = typeof a === 'string' && typeof v === 'string' && textIncludes(a, v.trim());
      return cond.op === 'contains' ? has : !has;
    }
    case 'eq':
    case 'neq':
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte':
      return (
        typeof a === 'string' && typeof v === 'string' && compares(cond.op, compareDecimal(a, v))
      );
    case 'before':
      return typeof a === 'string' && typeof v === 'string' && a < v;
    case 'after':
      return typeof a === 'string' && typeof v === 'string' && a > v;
    case 'is_any_of':
    case 'is_none_of': {
      const any = typeof a === 'string' && Array.isArray(v) && v.includes(a);
      return cond.op === 'is_any_of' ? any : !any;
    }
    case 'contains_any':
    case 'contains_all':
    case 'contains_none': {
      if (!Array.isArray(a) || !Array.isArray(v)) return false;
      const wanted = (v as unknown[]).map((id) =>
        source.config.type === 'person' && id === ME ? respondent.userId : id,
      );
      if (cond.op === 'contains_all') return wanted.every((id) => a.includes(id as Id));
      const any = wanted.some((id) => a.includes(id as Id));
      return cond.op === 'contains_any' ? any : !any;
    }
  }
}

interface Answered {
  prop: Property;
  value: unknown;
}

/** Whether a question's logic matches. Conditions still being set up, or that no longer fit their question, are left out. */
function logicMatches(
  question: FormQuestion,
  earlier: ReadonlyMap<Id, Answered>,
  respondent: Respondent,
): boolean {
  const results: boolean[] = [];
  for (const cond of question.logic?.conditions ?? []) {
    if (!isConditionSet(cond)) continue;
    const source = earlier.get(cond.questionPropertyId);
    if (!source) {
      results.push(WHEN_EMPTY[cond.op]);
      continue;
    }
    if (conditionProblem(cond, source.prop) !== null) continue;
    results.push(conditionMatches(cond, source.prop, source.value, respondent));
  }
  if (results.length === 0) return true;
  return question.logic?.combinator === 'or' ? results.includes(true) : !results.includes(false);
}

/**
 * Goes through the form's questions in order and calls `visit` for each with whether it shows.
 * `visit` returns the answer a shown question ends up with (null or undefined when empty); a hidden
 * question counts as empty for the questions after it. Questions whose property is gone or can't
 * be a question (Files in an anonymous form) are skipped, and so are repeats of a property.
 */
export function walkQuestions(
  def: FormDefinition,
  properties: readonly Property[],
  respondent: Respondent,
  anonymous: boolean,
  visit: (step: QuestionStep) => unknown,
): void {
  const earlier = new Map<Id, Answered>();
  for (const question of def.questions) {
    const prop = findProperty(properties, question.propertyId);
    if (!prop || earlier.has(prop.id) || questionKind(prop, question, { anonymous }) === null) {
      continue;
    }
    const shown = logicMatches(question, earlier, respondent);
    const value = visit({ question, prop, shown });
    earlier.set(prop.id, { prop, value: shown ? value : null });
  }
}

/**
 * The questions that show for these answers (stored values keyed by property id), in form order.
 * Logic follows the All or Any setting; a hidden question counts as empty, so the questions that
 * depend on it hide too. Text conditions ignore case and accents, numbers compare exactly, and
 * dates use their start day in the respondent's time zone.
 */
export function visibleQuestions(
  def: FormDefinition,
  answers: Readonly<Partial<Record<Id, unknown>>>,
  properties: readonly Property[],
  viewer: Respondent,
): Set<Id> {
  const shown = new Set<Id>();
  walkQuestions(def, properties, viewer, def.anonymous, ({ question, shown: isShown }) => {
    if (!isShown) return null;
    shown.add(question.propertyId);
    return answers[question.propertyId];
  });
  return shown;
}

/** The form with the question at `from` moved so it ends up at `to` (0-based). Check canMoveQuestion first. */
export function moveQuestion(def: FormDefinition, from: number, to: number): FormDefinition {
  const questions = [...def.questions];
  const [moving] = questions.splice(from, 1);
  if (!moving) return def;
  questions.splice(Math.max(0, Math.min(to, questions.length)), 0, moving);
  return { ...def, questions };
}

/**
 * Null when the question at `from` can move to `to`, otherwise why not: a question must stay below
 * every question its logic depends on ("'Reason' depends on 'Category', so it must stay below it.").
 */
export function canMoveQuestion(
  def: FormDefinition,
  from: number,
  to: number,
  properties: readonly Property[],
): string | null {
  const moving = def.questions[from];
  if (!moving || from === to || to < 0 || to >= def.questions.length) return null;
  const before = def.questions.map((q) => q.propertyId);
  const after = moveQuestion(def, from, to).questions.map((q) => q.propertyId);
  const breaks = (dependent: FormQuestion, sourceId: Id): boolean => {
    const d = dependent.propertyId;
    const wasBelow = before.indexOf(sourceId) < before.indexOf(d);
    return wasBelow && after.indexOf(sourceId) > after.indexOf(d);
  };
  const label = (q: FormQuestion) =>
    `'${questionLabel(q, findProperty(properties, q.propertyId))}'`;
  const blocked = (dependent: FormQuestion, source: FormQuestion) =>
    `${label(dependent)} depends on ${label(source)}, so it must stay below it.`;
  for (const cond of moving.logic?.conditions ?? []) {
    const source = def.questions.find((q) => q.propertyId === cond.questionPropertyId);
    if (source && breaks(moving, source.propertyId)) return blocked(moving, source);
  }
  for (const q of def.questions) {
    const dependsOnMoving = q.logic?.conditions.some(
      (c) => c.questionPropertyId === moving.propertyId,
    );
    if (dependsOnMoving && breaks(q, moving.propertyId)) return blocked(q, moving);
  }
  return null;
}

/** What pruneLogic changed. */
export interface PruneResult {
  /** The cleaned form (the same object when nothing changed). */
  def: FormDefinition;
  /** Questions (property ids) that lost a condition; they now show "Logic changed". */
  changed: Id[];
  /** Questions removed because their property was deleted or can no longer be a question. */
  removed: Id[];
}

/**
 * Cleans a form after a property, option or question goes away. Deleting a property removes its
 * question. A condition is removed, and its question marked "Logic changed", when its question is
 * gone or no longer above, an option it uses was deleted, or it no longer fits its question's type.
 * A question left without conditions has no logic.
 */
export function pruneLogic(def: FormDefinition, properties: readonly Property[]): PruneResult {
  const changed: Id[] = [];
  const removed: Id[] = [];
  const questions: FormQuestion[] = [];
  const earlier = new Map<Id, Property>();
  for (const q of def.questions) {
    const prop = findProperty(properties, q.propertyId);
    if (!prop || questionKind(prop, q) === null) {
      removed.push(q.propertyId);
      continue;
    }
    const conditions = q.logic?.conditions ?? [];
    const kept = conditions.filter((cond) => {
      const source = earlier.get(cond.questionPropertyId);
      return source !== undefined && conditionProblem(cond, source) === null;
    });
    earlier.set(prop.id, prop);
    if (!q.logic || kept.length === conditions.length) {
      questions.push(q);
      continue;
    }
    changed.push(q.propertyId);
    const logic = kept.length ? { ...q.logic, conditions: kept } : null;
    questions.push({ ...q, logic, logicChanged: true });
  }
  if (!changed.length && !removed.length) return { def, changed, removed };
  return { def: { ...def, questions }, changed, removed };
}
