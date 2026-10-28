// How much one event keeps, so requests can't make it grow without end: deleted and changed
// occurrences on a series, and each person's answers for single occurrences. A series that never
// ends has no last occurrence to stop them.
import { httpError } from '../../../core/errors';
import type { StoredPerson } from './items';
import type { Schedule } from './model';

/** Most deleted occurrences (exceptions) one series keeps. */
export const MAX_DELETED = 1000;
/** Most changed or moved occurrences (overrides) one series keeps; each has its own fields. */
export const MAX_CHANGED = 500;
/** Most answers for single occurrences one person keeps on one event. */
export const MAX_ANSWERS = 1000;

/** What a change past each limit is told. */
export const LIMIT_MESSAGES = {
  deleted:
    'A repeating event keeps up to 1,000 deleted occurrences. Delete this and following instead.',
  changed:
    'A repeating event keeps up to 500 changed occurrences. ' +
    'Change this and following, or all events, instead.',
  answers:
    'You can answer up to 1,000 single occurrences of one event. Answer for all events instead.',
};

/** A 400 when a series would keep more deleted or changed occurrences than it may. */
export function checkChanges(schedule: Pick<Schedule, 'exceptions' | 'overrides'>): void {
  if (schedule.exceptions.length > MAX_DELETED) {
    throw httpError(400, 'invalid', LIMIT_MESSAGES.deleted);
  }
  if (Object.keys(schedule.overrides).length > MAX_CHANGED) {
    throw httpError(400, 'invalid', LIMIT_MESSAGES.changed);
  }
}

/** A 400 when a person would keep more answers for single occurrences than they may. */
export function checkAnswers(person: Pick<StoredPerson, 'occurrenceReplies'>): void {
  if (Object.keys(person.occurrenceReplies).length > MAX_ANSWERS) {
    throw httpError(400, 'invalid', LIMIT_MESSAGES.answers);
  }
}
