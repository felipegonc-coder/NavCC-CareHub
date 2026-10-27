/**
 * Form questions (Forms spec v2, section 3): which properties can be questions and how each one
 * shows, the "Show if…" conditions each question type offers, and the checks a whole form passes.
 */
import { isCalendarDate } from '../dates';
import { isCanonicalDecimal } from '../decimal';
import { richTextLength } from '../richtext';
import { findProperty } from '../row';
import { LIMITS } from '../types';
import type {
  FormCondition,
  FormConditionOp,
  FormDefinition,
  FormQuestion,
  Id,
  Property,
} from '../types';

/** How a question shows on the fill screen. */
export type QuestionKind =
  | 'short'
  | 'long'
  | 'number'
  | 'radio'
  | 'checkboxes'
  | 'dropdown'
  | 'multi_dropdown'
  | 'date'
  | 'checkbox'
  | 'link'
  | 'email'
  | 'phone'
  | 'person'
  | 'files'
  | 'relation';

/** Select and multi-select questions list up to this many options as radio buttons or tick boxes; more use a dropdown. */
export const FORM_CHOICE_LIMIT = 7;

/** Who can respond (Share form → Who can respond). Absent means workspace members. */
export type FormAudience = NonNullable<FormDefinition['audience']>;

/** Who can respond to the form: members, unless it says otherwise. */
export function formAudience(def: Pick<FormDefinition, 'audience'>): FormAudience {
  return def.audience ?? 'members';
}

/**
 * True when the form's responses don't record their sender: Anonymous responses is on, or anyone
 * can fill the form in (always anonymous).
 */
export function isAnonymousForm(def: Pick<FormDefinition, 'anonymous' | 'audience'>): boolean {
  return def.anonymous || formAudience(def) === 'anyone';
}

/**
 * How a property shows as a question, or null when it can't be one. Status, Checklist, created
 * and edited properties, ID, formulas, rollups and buttons are never offered, and a form anyone
 * can fill in has no Person or Relation questions (they would show names and row titles).
 */
export function questionKind(
  prop: Property,
  question?: Pick<FormQuestion, 'display'> | null,
  opts: { audience?: FormAudience } = {},
): QuestionKind | null {
  const c = prop.config;
  const dropdown = question?.display === 'dropdown';
  const anyone = opts.audience === 'anyone';
  switch (c.type) {
    case 'title':
    case 'text':
      return question?.display === 'long' ? 'long' : 'short';
    case 'number':
      return 'number';
    case 'select':
      return dropdown || c.options.length > FORM_CHOICE_LIMIT ? 'dropdown' : 'radio';
    case 'multi_select':
      return dropdown || c.options.length > FORM_CHOICE_LIMIT ? 'multi_dropdown' : 'checkboxes';
    case 'date':
      return 'date';
    case 'checkbox':
      return 'checkbox';
    case 'url':
      return 'link';
    case 'email':
      return 'email';
    case 'phone':
      return 'phone';
    case 'person':
      return anyone ? null : 'person';
    case 'files':
      return 'files';
    case 'relation':
      return anyone ? null : 'relation';
    case 'status':
    case 'checklist':
    case 'created_time':
    case 'edited_time':
    case 'created_by':
    case 'edited_by':
    case 'unique_id':
    case 'formula':
    case 'rollup':
    case 'button':
      return null;
  }
}

/**
 * Properties "+ Add question" can offer: not asked yet and able to be a question for who can
 * respond, in database order.
 */
export function addableProperties(
  def: FormDefinition,
  properties: readonly Property[],
  audience: FormAudience = formAudience(def),
): Property[] {
  const asked = new Set(def.questions.map((q) => q.propertyId));
  return properties.filter((p) => !asked.has(p.id) && questionKind(p, null, { audience }) !== null);
}

/** The words a question shows: its own text, otherwise its property's name. */
export function questionLabel(question: FormQuestion, prop: Property | undefined): string {
  return question.text.trim() || prop?.name || 'Untitled';
}

// ---------------------------------------------------------------- conditions

const TEXT_OPS: readonly FormConditionOp[] = [
  'is',
  'is_not',
  'contains',
  'does_not_contain',
  'is_empty',
  'is_not_empty',
];
const NUMBER_OPS: readonly FormConditionOp[] = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'is_empty',
  'is_not_empty',
];
const SELECT_OPS: readonly FormConditionOp[] = [
  'is_any_of',
  'is_none_of',
  'is_empty',
  'is_not_empty',
];
const MULTI_SELECT_OPS: readonly FormConditionOp[] = [
  'contains_any',
  'contains_all',
  'contains_none',
  'is_empty',
  'is_not_empty',
];
const CHECKBOX_OPS: readonly FormConditionOp[] = ['is_checked', 'is_not_checked'];
const DATE_OPS: readonly FormConditionOp[] = ['is', 'before', 'after', 'is_empty', 'is_not_empty'];
const PEOPLE_OPS: readonly FormConditionOp[] = ['contains_any', 'is_empty', 'is_not_empty'];
const FILES_OPS: readonly FormConditionOp[] = ['is_empty', 'is_not_empty'];

/**
 * The "Show if…" conditions a question offers, by its property's type, in menu order (Forms spec):
 * text-like (Name, Text, Link, Email, Phone), Number, Select, Multi-select, Checkbox, Date, Person
 * and Relation, Files. Properties that can't be questions offer none.
 */
export function conditionOps(prop: Property): FormConditionOp[] {
  switch (prop.config.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return [...TEXT_OPS];
    case 'number':
      return [...NUMBER_OPS];
    case 'select':
      return [...SELECT_OPS];
    case 'multi_select':
      return [...MULTI_SELECT_OPS];
    case 'checkbox':
      return [...CHECKBOX_OPS];
    case 'date':
      return [...DATE_OPS];
    case 'person':
    case 'relation':
      return [...PEOPLE_OPS];
    case 'files':
      return [...FILES_OPS];
    default:
      return [];
  }
}

const OP_LABELS: Record<FormConditionOp, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  does_not_contain: 'does not contain',
  eq: 'equals',
  neq: 'not equal',
  gt: 'greater than',
  lt: 'less than',
  gte: 'at least',
  lte: 'at most',
  is_any_of: 'is any of',
  is_none_of: 'is none of',
  contains_any: 'contains any of',
  contains_all: 'contains all of',
  contains_none: 'contains none of',
  is_checked: 'is ticked',
  is_not_checked: 'is not ticked',
  before: 'is before',
  after: 'is after',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

/** The words for a condition in "Show this question only when…", as in the Forms spec ("is any of"). */
export function conditionOpLabel(op: FormConditionOp): string {
  return OP_LABELS[op];
}

/** Conditions that never take a value. */
const NO_VALUE: ReadonlySet<FormConditionOp> = new Set<FormConditionOp>([
  'is_checked',
  'is_not_checked',
  'is_empty',
  'is_not_empty',
]);

/** False while a condition still waits for its value (it's being set up); such conditions are ignored. */
export function isConditionSet(cond: Pick<FormCondition, 'op' | 'value'>): boolean {
  if (NO_VALUE.has(cond.op)) return true;
  const v: unknown = cond.value;
  if (typeof v === 'string') return v.trim() !== '';
  return Array.isArray(v) && v.length > 0;
}

const isIdList = (v: unknown): v is Id[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '');

/**
 * Why a condition on an earlier question (`source`) can't be used, or null when it's fine. A
 * condition still waiting for its value is fine: the builder saves as people set it up.
 */
export function conditionProblem(cond: FormCondition, source: Property): string | null {
  if (!conditionOps(source).includes(cond.op))
    return "That condition doesn't work for this question.";
  if (NO_VALUE.has(cond.op) || !isConditionSet(cond)) return null;
  const v: unknown = cond.value;
  const c = source.config;
  switch (c.type) {
    case 'number':
      return isCanonicalDecimal(v) ? null : 'Enter a number.';
    case 'date':
      return isCalendarDate(v) ? null : 'Enter a date.';
    case 'select':
    case 'multi_select': {
      if (!isIdList(v)) break;
      const ids = new Set(c.options.map((o) => o.id));
      return v.every((id) => ids.has(id)) ? null : "That option doesn't exist.";
    }
    case 'person':
    case 'relation':
      if (isIdList(v)) return null;
      break;
    default:
      if (typeof v === 'string') return null;
  }
  return "That condition's value doesn't work for this question.";
}

// ---------------------------------------------------------------- the whole form

const DESCRIPTION_TOO_LONG = 'Descriptions can be up to 2,000 characters.';

/**
 * Checks a form before it's saved: up to 100 questions, each property asked once and able to be
 * a question (no Person or Relation questions in a form anyone can fill in), descriptions and the
 * confirmation message up to 2,000 characters, no logic on the first question, up to 10
 * conditions, and conditions only on questions above, with a condition and value that fit that
 * question. Anonymous forms, and forms anyone can fill in, can't limit responses per person.
 * Returns the first problem, or null.
 */
export function validateFormDefinition(
  def: FormDefinition,
  properties: readonly Property[],
): string | null {
  if (def.questions.length > LIMITS.formQuestions) return 'Up to 100 questions.';
  if (!def.allowMultiple && formAudience(def) === 'anyone') {
    return "Forms anyone can fill in can't limit responses per person.";
  }
  if (!def.allowMultiple && def.anonymous) {
    return 'One response per person needs names. Turn off anonymous responses first.';
  }
  if (
    richTextLength(def.description) > LIMITS.formDescription ||
    richTextLength(def.confirmation) > LIMITS.formDescription
  ) {
    return DESCRIPTION_TOO_LONG;
  }
  const anyone = formAudience(def) === 'anyone';
  const earlier = new Map<Id, Property>();
  for (const [index, q] of def.questions.entries()) {
    const prop = findProperty(properties, q.propertyId);
    if (!prop) return "That property doesn't exist.";
    if (earlier.has(prop.id)) return `'${prop.name}' is already a question.`;
    if (anyone && (prop.config.type === 'person' || prop.config.type === 'relation')) {
      return "Forms anyone can fill in can't ask for people or rows.";
    }
    if (questionKind(prop, q) === null) return `'${prop.name}' can't be a form question.`;
    if (richTextLength(q.description) > LIMITS.formDescription) return DESCRIPTION_TOO_LONG;
    const conditions = q.logic?.conditions ?? [];
    if (conditions.length > LIMITS.formConditions) return 'Up to 10 conditions.';
    if (index === 0 && conditions.length > 0) return "The first question can't have logic.";
    for (const cond of conditions) {
      const source = earlier.get(cond.questionPropertyId);
      if (!source) return `'${questionLabel(q, prop)}' can only depend on questions above it.`;
      const problem = conditionProblem(cond, source);
      if (problem) return problem;
    }
    earlier.set(prop.id, prop);
  }
  return null;
}

/** Question kinds people type into: their answers can say who they are. */
const TYPED_KINDS: ReadonlySet<QuestionKind> = new Set([
  'short',
  'long',
  'number',
  'link',
  'email',
  'phone',
]);

/**
 * The builder's warning for an anonymous form whose questions could still identify someone:
 * Person questions, or answers people type. null when the form records senders or has neither.
 */
export function anonymityWarning(
  def: FormDefinition,
  properties: readonly Property[],
): string | null {
  if (!isAnonymousForm(def)) return null;
  const audience = formAudience(def);
  const identifying = def.questions.some((q) => {
    const prop = findProperty(properties, q.propertyId);
    const kind = prop ? questionKind(prop, q, { audience }) : null;
    return kind !== null && (kind === 'person' || TYPED_KINDS.has(kind));
  });
  return identifying
    ? 'Answers can still show who sent them (Person questions, or what people type).'
    : null;
}
