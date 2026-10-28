/**
 * Pure helpers for the form builder: the form a Form view shows, and the changes the builder makes
 * to it (questions, logic and settings). The rules (what can be a question, which conditions fit,
 * moves and the checks before saving) come from '@carehub/databases/forms'.
 */
import {
  defaultForm,
  newId,
  zonedParts,
  zonedToInstant,
  type DatabaseMeta,
  type FormCondition,
  type FormDefinition,
  type FormLogic,
  type FormQuestion,
  type Id,
  type Instant,
  type Property,
  type PropertyType,
  type View,
} from '@carehub/databases';
import { conditionOps, pruneLogic } from '@carehub/databases/forms';

/**
 * The form a Form view shows, cleaned after properties or options went away (conditions that no
 * longer fit are dropped and their questions show "Logic changed"). A view without a saved form
 * gets a new one titled with the database's name.
 */
export function viewForm(
  view: Pick<View, 'form'>,
  meta: Pick<DatabaseMeta, 'title' | 'properties'>,
): FormDefinition {
  return pruneLogic(view.form ?? defaultForm(meta.title, meta.properties), meta.properties).def;
}

/** A question for a property: its text starts as the property's name. */
export function newQuestion(prop: Property): FormQuestion {
  return {
    propertyId: prop.id,
    text: prop.name,
    description: [],
    required: false,
    display: 'default',
    logic: null,
  };
}

/** The form with a question for the property at the end (unless it's asked already). */
export function addQuestion(def: FormDefinition, prop: Property): FormDefinition {
  if (def.questions.some((q) => q.propertyId === prop.id)) return def;
  return { ...def, questions: [...def.questions, newQuestion(prop)] };
}

/**
 * The form without the question. Its property stays. Questions whose logic used it lose those
 * conditions and show "Logic changed".
 */
export function removeQuestion(
  def: FormDefinition,
  propertyId: Id,
  properties: readonly Property[],
): FormDefinition {
  const questions = def.questions.filter((q) => q.propertyId !== propertyId);
  return pruneLogic({ ...def, questions }, properties).def;
}

export type QuestionChange = Partial<
  Pick<FormQuestion, 'text' | 'description' | 'required' | 'display'>
>;

export function changeQuestion(
  def: FormDefinition,
  propertyId: Id,
  change: QuestionChange,
): FormDefinition {
  return {
    ...def,
    questions: def.questions.map((q) => (q.propertyId === propertyId ? { ...q, ...change } : q)),
  };
}

/** New logic for a question: no conditions means no logic. Changing it clears "Logic changed". */
export function changeLogic(
  def: FormDefinition,
  propertyId: Id,
  logic: FormLogic | null,
): FormDefinition {
  const next = logic && logic.conditions.length > 0 ? logic : null;
  return {
    ...def,
    questions: def.questions.map((q) => {
      if (q.propertyId !== propertyId) return q;
      const changed: FormQuestion = { ...q, logic: next };
      delete changed.logicChanged;
      return changed;
    }),
  };
}

/** A new condition on an earlier question: its first kind of condition, waiting for a value. */
export function newCondition(source: Property): FormCondition {
  return { id: newId(), questionPropertyId: source.id, op: conditionOps(source)[0] ?? 'is_empty' };
}

/** The questions a question's logic can use: the ones above it. */
export function questionsAbove(def: FormDefinition, propertyId: Id): FormQuestion[] {
  const at = def.questions.findIndex((q) => q.propertyId === propertyId);
  return at < 0 ? [] : def.questions.slice(0, at);
}

/** The setting a question's type has for how it shows, if any. */
export function displaySetting(
  prop: Property,
): { label: string; display: 'long' | 'dropdown' } | null {
  switch (prop.config.type) {
    case 'title':
    case 'text':
      return { label: 'Long answer', display: 'long' };
    case 'select':
    case 'multi_select':
      return { label: 'Always a dropdown', display: 'dropdown' };
    default:
      return null;
  }
}

/**
 * The types "New question" makes. Relations need the database they point to, so they come from
 * the database's own property menu and are then added from the list.
 */
export const NEW_QUESTION_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'person',
  'files',
] as const satisfies readonly PropertyType[];
export type NewQuestionType = (typeof NEW_QUESTION_TYPES)[number];

export function isNewQuestionType(type: string): type is NewQuestionType {
  return (NEW_QUESTION_TYPES as readonly string[]).includes(type);
}

/** The form's link. */
export function formUrl(code: string, origin: string): string {
  return `${origin}/forms/${encodeURIComponent(code)}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A close time as a date-and-time box shows it ("2026-10-30T17:00"), in the viewer's time zone. */
export function closeAtValue(closeAt: Instant | null | undefined, timeZone: string): string {
  if (!closeAt) return '';
  const p = zonedParts(closeAt, timeZone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** What a date-and-time box holds as the moment it means in the viewer's time zone; null if empty. */
export function closeAtFromValue(value: string, timeZone: string): Instant | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m || m[1] === undefined) return null;
  return zonedToInstant(m[1], Number(m[2]), Number(m[3]), timeZone);
}

/** "Close after a number of responses": null for no limit, undefined when it isn't a whole number from 1. */
export function maxResponsesFrom(value: string): number | null | undefined {
  const t = value.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && Number.isSafeInteger(n) ? n : undefined;
}

/** "Notify me about new responses" on or off for one person. */
export function withNotify(def: FormDefinition, userId: Id, on: boolean): FormDefinition {
  const others = def.notifyUserIds.filter((id) => id !== userId);
  return { ...def, notifyUserIds: on ? [...others, userId] : others };
}
