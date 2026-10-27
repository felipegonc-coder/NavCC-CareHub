import { COPY } from './constants';
import type { NameOf, PersonLabel } from './types';

/** "Sam Ortiz", "Sam Ortiz (removed)" or "Unknown person". */
export function personName(person: PersonLabel | undefined): string {
  if (!person) return COPY.unknownPerson;
  return person.removed ? `${person.name} ${COPY.removedSuffix}` : person.name;
}

/** Names for user IDs, in the same order. */
export function namesOf(userIds: readonly string[], nameOf: NameOf): string[] {
  return userIds.map((id) => personName(nameOf(id)));
}

/**
 * Joins names the way the spec writes them: "Avery Lin", "Avery Lin and Sam Ortiz",
 * "Avery Lin, Sam Ortiz and Riley Chen", "Avery Lin, Sam Ortiz and 2 others".
 * Shows at most `max` names, except that one extra name is shown rather than "and 1 other".
 */
export function listNames(names: readonly string[], max = 2): string {
  const limit = Math.max(1, Math.floor(max));
  if (names.length > limit + 1) {
    return `${names.slice(0, limit).join(', ')} and ${names.length - limit} others`;
  }
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}
