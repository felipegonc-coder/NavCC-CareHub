import type { Id } from '../format/index';
import { frozen } from './shared';

/**
 * A made-up person for tests and demos, shaped like a workspace member (main renamed teams to groups).
 * Emails use the reserved example.test domain, like the core seed accounts.
 */
export type SampleLearner = {
  id: Id;
  name: string;
  email: string;
  groupIds: Id[];
  managerId: Id | null;
  timeZone: string;
};
/** A made-up group, shaped like `GET /api/workspace/groups`. */
export type SampleGroup = { id: Id; name: string; memberIds: Id[] };

const learner = (
  id: Id,
  name: string,
  groupIds: Id[],
  managerId: Id | null,
  timeZone: string,
): SampleLearner => ({
  id: `learner-${id}`,
  name,
  email: `${name.toLowerCase().replace(' ', '.')}@example.test`,
  groupIds,
  managerId: managerId === null ? null : `learner-${managerId}`,
  timeZone,
});

const FRONT_DESK = 'group-front-desk';
const NIGHT_SHIFT = 'group-night-shift';

export const sampleLearners: readonly SampleLearner[] = frozen([
  learner('avery', 'Avery Quinn', [FRONT_DESK], 'dana', 'America/Denver'),
  learner('bea', 'Bea Okafor', [FRONT_DESK], 'dana', 'America/Denver'),
  learner('carlos', 'Carlos Mendes', [FRONT_DESK], 'dana', 'America/Sao_Paulo'),
  learner('dana', 'Dana Whitfield', [FRONT_DESK, NIGHT_SHIFT], null, 'America/New_York'),
  learner('eli', 'Eli Novak', [NIGHT_SHIFT], 'farah', 'Europe/Lisbon'),
  learner('farah', 'Farah Siddiqui', [NIGHT_SHIFT], null, 'Europe/London'),
  learner('gus', 'Gus Lindqvist', [NIGHT_SHIFT], 'farah', 'Pacific/Auckland'),
  learner('hana', 'Hana Ito', [], 'dana', 'Asia/Tokyo'),
]);

const membersOf = (groupId: Id) =>
  sampleLearners.filter((person) => person.groupIds.includes(groupId)).map((person) => person.id);

export const sampleGroups: readonly SampleGroup[] = frozen([
  { id: FRONT_DESK, name: 'Front desk team', memberIds: membersOf(FRONT_DESK) },
  { id: NIGHT_SHIFT, name: 'Night shift team', memberIds: membersOf(NIGHT_SHIFT) },
]);
