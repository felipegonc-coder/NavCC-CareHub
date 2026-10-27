// People a query shows (W2-3): names for formulas and group labels, emails for formulas, who was
// removed from the workspace, and the `people` map of the answer ({ name, avatarUrl } for everyone
// the rows show after property access).
import type { ComputedValue, Id, Property, Row } from '@carehub/databases';
import type { QueryGroup, QueryRow } from '@carehub/databases/engine';
import { sql } from 'drizzle-orm';
import { isUuid } from './record';
import { uuidList, type Executor } from './store';

/** How the answer names a person. */
export interface PersonShown {
  name: string;
  avatarUrl: string | null;
}

/** The people a query may name, by user id. */
export interface PeopleBook {
  name(id: Id): string | undefined;
  email(id: Id): string | undefined;
  /** Not (or no longer) a member of the workspace: shows as "Name (removed)". */
  removed(id: Id): boolean;
  shown(id: Id): PersonShown | undefined;
}

const CHUNK = 5_000;

/** Everyone the rows name: Person values, Created by and Edited by. */
export function personIdsIn(rows: Iterable<Row>, properties: readonly Property[]): Set<Id> {
  const people = properties.filter((p) => p.config.type === 'person').map((p) => p.id);
  const out = new Set<Id>();
  for (const row of rows) {
    if (row.createdBy) out.add(row.createdBy);
    if (row.editedBy) out.add(row.editedBy);
    for (const id of people) {
      const value = row.values[id];
      if (!Array.isArray(value)) continue;
      for (const person of value) if (typeof person === 'string') out.add(person);
    }
  }
  return out;
}

type PersonRow = {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  removed: boolean;
};

/** Names, emails and avatars of these people, and whether they're still in the workspace. */
export async function loadPeople(
  db: Executor,
  workspaceId: string,
  ids: Iterable<Id>,
): Promise<PeopleBook> {
  const list = [...new Set(ids)].filter(isUuid);
  const found = new Map<Id, PersonRow>();
  for (let i = 0; i < list.length; i += CHUNK) {
    const { rows } = await db.execute<PersonRow>(sql`
      SELECT u.id, u.name, u.email, u.avatar_url, m.user_id IS NULL AS removed
      FROM users u LEFT JOIN workspace_members m
        ON m.user_id = u.id AND m.workspace_id = ${workspaceId}::uuid
      WHERE u.id = ANY(${uuidList(list.slice(i, i + CHUNK))})`);
    for (const r of rows) found.set(r.id, r);
  }
  return {
    name: (id) => found.get(id)?.name,
    email: (id) => found.get(id)?.email,
    removed: (id) => found.get(id)?.removed === true,
    shown: (id) => {
      const r = found.get(id);
      return r ? { name: r.name, avatarUrl: r.avatar_url } : undefined;
    },
  };
}

function peopleInValue(value: ComputedValue, into: Set<Id>): void {
  if (value.kind === 'person') into.add(value.value);
  else if (value.kind === 'list') for (const item of value.value) peopleInValue(item, into);
}

/**
 * The answer's `people`: everyone its rows show (Person values, Created by, Edited by and people in
 * formula and rollup results, as projected for the viewer) and people that group by person.
 */
export function peopleShown(
  answer: { rows: readonly QueryRow[]; groups: readonly QueryGroup[] | null },
  properties: readonly Property[],
  book: PeopleBook,
): Record<Id, PersonShown> {
  const personProps = properties.filter((p) => p.config.type === 'person').map((p) => p.id);
  const ids = new Set<Id>();
  const fromRow = (row: QueryRow) => {
    if (row.createdBy) ids.add(row.createdBy);
    if (row.editedBy) ids.add(row.editedBy);
    for (const id of personProps) {
      const value = row.values[id];
      if (Array.isArray(value)) for (const v of value) if (typeof v === 'string') ids.add(v);
    }
    for (const value of Object.values(row.computed)) if (value) peopleInValue(value, ids);
  };
  const fromGroup = (group: QueryGroup) => {
    if (book.shown(group.key)) ids.add(group.key);
    group.rows.forEach(fromRow);
    group.subGroups?.forEach(fromGroup);
  };
  answer.rows.forEach(fromRow);
  answer.groups?.forEach(fromGroup);
  const out: Record<Id, PersonShown> = {};
  for (const id of [...ids].sort()) {
    const person = book.shown(id);
    if (person) out[id] = person;
  }
  return out;
}
