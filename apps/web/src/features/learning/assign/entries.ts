import type { Assignment } from '@carehub/learning';
import { formatDay, formatDueDate } from '../home/entry';
import { countText } from './form';

// What the Assign screen's list says about each assignment: a path's courses stay together, as one.

/** Who made the assignments Care Hub makes itself when a certificate runs out (the server's). */
export const RECERTIFICATION_ASSIGNER = '00000000-0000-0000-0000-000000000000';

/** One assignment as the list shows it: one course, or a path with a row for each course. */
export type AssignmentEntry = {
  /** The first row's id. Removing it removes the whole path assignment on the server. */
  id: string;
  pathId: string | null;
  rows: Assignment[];
  people: string[];
  groups: string[];
  dueDate: string | null;
  dueInDays: number | null;
  required: boolean;
  createdBy: string;
  createdAt: string;
};

/** The rows of one path assignment share the path, the moment and the person who made them. */
const batchOf = (row: Assignment) =>
  row.pathId === null ? `course ${row.id}` : `path ${row.pathId} ${row.createdAt} ${row.createdBy}`;

/** The server's rows (oldest first) as entries, newest first. */
export function entriesOf(rows: readonly Assignment[]): AssignmentEntry[] {
  const batches = new Map<string, Assignment[]>();
  for (const row of rows) batches.set(batchOf(row), [...(batches.get(batchOf(row)) ?? []), row]);
  const entries: AssignmentEntry[] = [];
  for (const batch of batches.values()) {
    const [first] = batch;
    if (!first) continue;
    const { id, pathId, people, groups, dueDate, dueInDays, required, createdBy, createdAt } =
      first;
    entries.push({
      id,
      pathId,
      rows: batch,
      people,
      groups,
      dueDate,
      dueInDays,
      required,
      createdBy,
      createdAt,
    });
  }
  return entries.reverse();
}

/** A course's live title, or what to call it when it's gone. */
export const courseTitleOf = (row: Assignment): string =>
  row.courseTitle ?? 'A course that is no longer published';

/** What the entry is called: the path's title, or its course's. */
export function titleOf(entry: AssignmentEntry, pathTitles: ReadonlyMap<string, string>): string {
  if (entry.pathId !== null) return pathTitles.get(entry.pathId) ?? 'A learning path';
  const [row] = entry.rows;
  return row ? courseTitleOf(row) : 'A course that is no longer published';
}

/** "Tara", "Tara and Omar", "Tara, Omar and Priya". */
export function listText(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Names to show for people and groups; null when the list couldn't be read. */
export type Names = {
  people: ReadonlyMap<string, string> | null;
  groups: ReadonlyMap<string, string> | null;
};

/**
 * Who the assignment is for: up to three names, then "and 4 more". Groups say "(group)". People
 * no longer in the workspace are "former members"; without names, it counts ("2 people").
 */
export function whoText(entry: Pick<AssignmentEntry, 'people' | 'groups'>, names: Names): string {
  if (!names.people) return countText(entry.people.length, entry.groups.length);
  const people = names.people;
  const groups = names.groups;
  const shown = [
    ...entry.people.flatMap((id) => people.get(id) ?? []),
    ...entry.groups.flatMap((id) => {
      const name = groups?.get(id);
      return name === undefined ? [] : [`${name} (group)`];
    }),
  ];
  const former = entry.people.filter((id) => !people.has(id)).length;
  const otherGroups = entry.groups.filter((id) => groups?.get(id) === undefined).length;
  const rest = [
    shown.length > 3 && `${shown.length - 3} more`,
    former > 0 && plural(former, 'former member', 'former members'),
    otherGroups > 0 &&
      plural(otherGroups, groups ? 'removed group' : 'group', groups ? 'removed groups' : 'groups'),
  ].filter((part): part is string => typeof part === 'string');
  return listText([...shown.slice(0, 3), ...rest]) || 'no one';
}

/** "Due 30 Oct 2026", "Due 14 days after it's assigned" or "No due date". */
export function dueText(entry: Pick<AssignmentEntry, 'dueDate' | 'dueInDays'>): string {
  if (entry.dueDate !== null) return `Due ${formatDueDate(entry.dueDate)}`;
  if (entry.dueInDays !== null)
    return `Due ${plural(entry.dueInDays, 'day', 'days')} after it's assigned`;
  return 'No due date';
}

/** Who assigned it and when, or that Care Hub did, for a re-certification. */
export function byText(
  entry: Pick<AssignmentEntry, 'createdBy' | 'createdAt'>,
  people: ReadonlyMap<string, string> | null,
): string {
  if (entry.createdBy === RECERTIFICATION_ASSIGNER) {
    return 'Assigned by Care Hub for re-certification';
  }
  const name = people?.get(entry.createdBy);
  const by = name ?? (people ? 'a former member' : 'someone in this workspace');
  return `Assigned by ${by} on ${formatDay(entry.createdAt)}`;
}
