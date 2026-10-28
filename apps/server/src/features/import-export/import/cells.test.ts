import type { PlanColumnType, PlanDatabase } from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import type { Tx } from '../../../db';
import { cellPieces, databaseCells, matchPeople, rowLinks } from './cells';
import { importPorts, type ImportPorts } from './ports';

const members = [
  { userId: 'u1', email: 'Avery.Kim@example.test', name: 'Avery Kim' },
  { userId: 'u2', email: 'jordan@example.test', name: 'Jordan Lee' },
  { userId: 'u3', email: 'jordan.lee@example.test', name: 'Jordan Lee' },
];

const database = (
  cells: string[][],
  types: PlanColumnType[] = ['person', 'relation'],
): PlanDatabase => ({
  key: 'd1',
  parent: null,
  title: 'Visits',
  columns: [
    { name: 'Name', type: 'person' },
    { name: 'Who', type: types[0] ?? null },
    { name: 'Follows', type: types[1] ?? null },
  ],
  rows: cells.map((row, index) => ({ key: `r${index + 1}`, cells: row })),
  source: 'visits.json',
});

describe('person and relation cells', () => {
  it('splits a cell on commas', () => {
    expect(cellPieces(' Avery Kim ,, jordan@example.test ')).toEqual([
      'Avery Kim',
      'jordan@example.test',
    ]);
    expect(cellPieces(undefined)).toEqual([]);
  });

  it('matches people by email in any case, then by exact name, and says why not', () => {
    const matches = matchPeople(
      ['avery.kim@EXAMPLE.test', 'Avery Kim', 'avery kim', 'Jordan Lee', 'jordan.lee@example.test'],
      members,
    );
    expect(Object.fromEntries(matches)).toEqual({
      'avery.kim@EXAMPLE.test': { userId: 'u1' },
      'Avery Kim': { userId: 'u1' },
      'avery kim': { why: 'No member has the name or email "avery kim".' },
      'Jordan Lee': { why: 'More than one member is called "Jordan Lee".' },
      'jordan.lee@example.test': { userId: 'u3' },
    });
  });

  it('asks for the people once, and leaves the rows names and other columns as they are', async () => {
    const asked: string[][] = [];
    const ports: ImportPorts = {
      ...importPorts(),
      findMembers: async (_db, _workspaceId, texts) => {
        asked.push([...texts]);
        return members;
      },
    };
    const visits = database([
      ['Avery Kim', 'Avery Kim, avery.kim@example.test', 'r2'],
      ['Check-in', 'Sam Ortiz', ''],
      ['Short'],
    ]);
    const { rows, problems } = await databaseCells({} as Tx, ports, 'w1', visits);
    expect(asked).toEqual([['Avery Kim', 'avery.kim@example.test', 'Sam Ortiz']]);
    expect(rows).toEqual([['Avery Kim', 'u1', ''], ['Check-in', '', ''], ['Short']]);
    expect(problems).toEqual([
      {
        file: 'visits.json',
        what: 'Left out',
        why: 'No member has the name or email "Sam Ortiz".',
      },
    ]);
    const plain = database([['Avery Kim', 'Avery Kim', 'r2']], ['text', 'text']);
    expect(await databaseCells({} as Tx, ports, 'w1', plain)).toEqual({
      rows: [['Avery Kim', 'Avery Kim', 'r2']],
      problems: [],
    });
    expect(asked).toHaveLength(1);
  });

  it("links rows of the same database once they're made, and counts the other links", () => {
    const visits = database([
      ['First', '', ''],
      ['Second', '', 'r1, r1'],
      ['Third', '', 'r2, r1, r7, d1'],
    ]);
    expect(rowLinks(visits, 'db', ['a', 'b', 'c'])).toEqual({
      columns: [
        {
          databaseId: 'db',
          column: 'Follows',
          links: [
            { rowId: 'b', to: ['a'] },
            { rowId: 'c', to: ['b', 'a'] },
          ],
        },
      ],
      missing: 2,
    });
    expect(rowLinks(database([['First', '', '']]), 'db', ['a'])).toEqual({
      columns: [],
      missing: 0,
    });
  });
});
