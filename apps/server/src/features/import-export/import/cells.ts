import type {
  ImportProblem,
  PlanColumnType,
  PlanDatabase,
} from '@carehub/extras/import-export/import/index';
import type { Tx } from '../../../db';
import type { ImportMember, ImportPorts, RowLinks } from './ports';

// Person and relation columns (Import and export spec 3.1 and 3.2): a cell holds people by email
// or name, or keys of rows of the same database, with ", " between them.

/** The people or row keys in a cell. */
export const cellPieces = (cell: string | undefined) =>
  (cell ?? '')
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');

/** The indexes of a type's columns. The first column is the rows' names, whatever its type. */
const columnsOf = (database: PlanDatabase, type: PlanColumnType) =>
  database.columns.flatMap((column, index) => (index > 0 && column.type === type ? [index] : []));

/** A member's user id, or why a person isn't one. */
export type PersonMatch = { userId: string } | { why: string };

/**
 * Who each text is (spec 3.1): the member with that email, in any case, otherwise the one member
 * with exactly that name.
 */
export function matchPeople(
  texts: Iterable<string>,
  members: readonly ImportMember[],
): Map<string, PersonMatch> {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const member of members) {
    byEmail.set(member.email.toLowerCase(), member.userId);
    byName.set(member.name, [...(byName.get(member.name) ?? []), member.userId]);
  }
  const matches = new Map<string, PersonMatch>();
  for (const text of texts) {
    const named = byName.get(text) ?? [];
    const userId = byEmail.get(text.toLowerCase()) ?? (named.length === 1 ? named[0] : undefined);
    const why =
      named.length > 1
        ? `More than one member is called "${text}".`
        : `No member has the name or email "${text}".`;
    matches.set(text, userId === undefined ? { why } : { userId });
  }
  return matches;
}

/**
 * The rows' cells as createDatabase takes them: person cells become the ids of the members found,
 * and relation cells are emptied for linkRows. Each person not found is listed once.
 */
export async function databaseCells(
  tx: Tx,
  ports: ImportPorts,
  workspaceId: string,
  database: PlanDatabase,
): Promise<{ rows: string[][]; problems: ImportProblem[] }> {
  const people = columnsOf(database, 'person');
  const relations = columnsOf(database, 'relation');
  const texts = new Set<string>();
  for (const row of database.rows) {
    for (const index of people) for (const text of cellPieces(row.cells[index])) texts.add(text);
  }
  const members = texts.size > 0 ? await ports.findMembers(tx, workspaceId, [...texts]) : [];
  const matches = matchPeople(texts, members);
  const rows = database.rows.map(({ cells }) =>
    cells.map((cell, index) => {
      if (relations.includes(index)) return '';
      if (!people.includes(index)) return cell;
      const ids = cellPieces(cell).flatMap((text) => {
        const match = matches.get(text);
        return match && 'userId' in match ? [match.userId] : [];
      });
      return [...new Set(ids)].join(', ');
    }),
  );
  const problems = [...matches.values()].flatMap((match) =>
    'why' in match ? [{ file: database.source, what: 'Left out', why: match.why }] : [],
  );
  return { rows, problems };
}

/**
 * Each relation column's links, once the rows are made (`rowIds`, in the rows' order). Keys that
 * aren't rows of this database are left out and counted.
 */
export function rowLinks(
  database: PlanDatabase,
  databaseId: string,
  rowIds: readonly string[],
): { columns: RowLinks[]; missing: number } {
  const idOf = new Map(database.rows.map((row, index) => [row.key, rowIds[index]]));
  let missing = 0;
  const columns: RowLinks[] = [];
  for (const index of columnsOf(database, 'relation')) {
    const links: RowLinks['links'] = [];
    for (const [at, row] of database.rows.entries()) {
      const to = new Set<string>();
      for (const key of cellPieces(row.cells[index])) {
        const id = idOf.get(key);
        if (id === undefined) missing += 1;
        else to.add(id);
      }
      const rowId = rowIds[at];
      if (rowId !== undefined && to.size > 0) links.push({ rowId, to: [...to] });
    }
    const column = database.columns[index]?.name ?? '';
    if (links.length > 0) columns.push({ databaseId, column, links });
  }
  return { columns, missing };
}
