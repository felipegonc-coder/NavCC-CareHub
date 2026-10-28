import { ASSIGNMENT_LIMITS, type ApiIssue, type CreateAssignmentsRequest } from '@carehub/learning';

// The new-assignment form as plain data: what the person picked, the request it makes and the
// messages for what to fix (docs/learning/api.md, POST /assignments).

/** When it's due: never, on a calendar day, or a number of days after each person gets it. */
export type DueChoice = 'none' | 'date' | 'days';

/** The form's values. `target` is "course:<id>" or "path:<id>", or "" before a choice. */
export type AssignDraft = {
  target: string;
  people: string[];
  groups: string[];
  due: DueChoice;
  dueDate: string;
  dueInDays: string;
  required: boolean;
};

export const emptyDraft: AssignDraft = {
  target: '',
  people: [],
  groups: [],
  due: 'none',
  dueDate: '',
  dueInDays: '',
  required: true,
};

/** The parts of the form a message can belong to; `who` is the people and groups together. */
export type DraftField = 'target' | 'who' | 'dueDate' | 'dueInDays';
export type DraftErrors = Partial<Record<DraftField, string>>;

/** Form fields in the order they're shown, so the first one to fix gets the focus. */
export const FIELD_ORDER: readonly DraftField[] = ['target', 'who', 'dueDate', 'dueInDays'];

export const targetValue = (type: 'course' | 'path', id: string): string => `${type}:${id}`;

function targetOf(value: string): CreateAssignmentsRequest['target'] | null {
  const split = value.indexOf(':');
  const type = value.slice(0, split);
  const id = value.slice(split + 1);
  if (split < 1 || !id || (type !== 'course' && type !== 'path')) return null;
  return { type, id };
}

/** The request the form makes, or what to fix first. `today` is YYYY-MM-DD. */
export function requestFrom(
  draft: AssignDraft,
  today: string,
): { request: CreateAssignmentsRequest } | { errors: DraftErrors } {
  const errors: DraftErrors = {};
  const target = targetOf(draft.target);
  if (!target) errors.target = 'Choose a course or path.';
  if (draft.people.length + draft.groups.length === 0) {
    errors.who = 'Choose at least one person or group.';
  } else if (draft.people.length > ASSIGNMENT_LIMITS.people) {
    errors.who = `Choose at most ${ASSIGNMENT_LIMITS.people} people at a time.`;
  } else if (draft.groups.length > ASSIGNMENT_LIMITS.groups) {
    errors.who = `Choose at most ${ASSIGNMENT_LIMITS.groups} groups at a time.`;
  }
  let due: { dueDate?: string; dueInDays?: number } = {};
  if (draft.due === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) errors.dueDate = 'Choose a due date.';
    else if (draft.dueDate < today) errors.dueDate = 'Choose today or a later day.';
    else due = { dueDate: draft.dueDate };
  } else if (draft.due === 'days') {
    const text = draft.dueInDays.trim();
    const days = Number(text);
    if (!/^\d+$/.test(text) || days < 1 || days > ASSIGNMENT_LIMITS.dueInDays) {
      errors.dueInDays = `Enter a whole number of days from 1 to ${ASSIGNMENT_LIMITS.dueInDays}.`;
    } else {
      due = { dueInDays: days };
    }
  }
  if (!target || Object.keys(errors).length > 0) return { errors };
  const { people, groups, required } = draft;
  return { request: { target, people, groups, ...due, required } };
}

const FIELD_OF: Record<string, DraftField> = {
  target: 'target',
  people: 'who',
  groups: 'who',
  dueDate: 'dueDate',
  dueInDays: 'dueInDays',
};

/** The server's messages, by form field; `other` holds the ones that belong to none. */
export function errorsFromIssues(issues: readonly ApiIssue[]): {
  errors: DraftErrors;
  other: string[];
} {
  const errors: DraftErrors = {};
  const other: string[] = [];
  for (const { path, message } of issues) {
    const field = FIELD_OF[path.split(/[.[]/)[0] ?? ''];
    if (!field) other.push(message);
    else errors[field] ??= message;
  }
  return { errors, other };
}

/** "1 person", "3 people and 1 group": who an assignment was made for. */
export function countText(people: number, groups: number): string {
  const parts = [
    people > 0 && `${people} ${people === 1 ? 'person' : 'people'}`,
    groups > 0 && `${groups} ${groups === 1 ? 'group' : 'groups'}`,
  ].filter((part): part is string => typeof part === 'string');
  return parts.join(' and ') || 'no one';
}

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The people whose name or email has every word of `query` in it, accents and case aside. */
export function findPeople<P extends { name: string; email?: string | undefined }>(
  people: readonly P[],
  query: string,
): P[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  return people.filter((person) => {
    const text = plain(`${person.name} ${person.email ?? ''}`);
    return words.every((word) => text.includes(word));
  });
}

/** A published course that can be assigned. `listed`: it's in the catalog. */
export type CourseOption = { id: string; title: string; listed: boolean };

/** A course in the Studio's list (GET /studio/courses), as far as assigning goes. */
export type StudioCourse = {
  id: string;
  title: string;
  state: 'draft' | 'live' | 'changed';
  archived: boolean;
  listed: boolean;
};

/**
 * The published courses to choose from, by title: the catalog's, and for people who build courses
 * (`studio`, null for the others) also those not in the catalog. Never drafts or archived ones.
 */
export function courseOptions(
  catalog: readonly { id: string; title: string }[],
  studio: readonly StudioCourse[] | null,
): CourseOption[] {
  const options = new Map<string, CourseOption>();
  for (const { id, title } of catalog) options.set(id, { id, title, listed: true });
  for (const course of studio ?? []) {
    if (course.state === 'draft' || course.archived || options.has(course.id)) continue;
    options.set(course.id, { id: course.id, title: course.title, listed: course.listed });
  }
  return [...options.values()].sort((a, b) => a.title.localeCompare(b.title));
}
