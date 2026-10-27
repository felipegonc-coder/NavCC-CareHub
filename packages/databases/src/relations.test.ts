import { describe, expect, it } from 'vitest';
import {
  backLinks,
  duplicateRelations,
  hiddenRowsLabel,
  linkDiff,
  remapForDuplicate,
  twoWayWrites,
  visibleLinks,
  type ReadLinks,
} from './relations';
import { THIS_PAGE, type ConfigOf, type Id, type Property, type Row } from './types';

const relation = (
  id: string,
  targetDatabaseId: string,
  single: boolean,
  twoWayPropertyId: string | null,
): Property<ConfigOf<'relation'>> => ({
  id,
  name: id,
  description: '',
  config: { type: 'relation', targetDatabaseId, single, twoWayPropertyId },
  rowPage: 'always',
});
const cells =
  (data: Record<Id, Id[]>): ReadLinks =>
  (rowId) =>
    data[rowId];
const row = (id: string, values: Row['values']): Row => ({
  id,
  title: id,
  values,
  createdAt: '2026-10-20T15:00:00.000Z',
  createdBy: 'u-avery',
  editedAt: '2026-10-20T15:00:00.000Z',
  editedBy: 'u-avery',
  uniqueNumber: null,
});

describe('linkDiff', () => {
  it('lists added links in the new order and removed ones in the old order', () => {
    expect(linkDiff(['a', 'b', 'c'], ['d', 'b', 'e'])).toEqual({
      added: ['d', 'e'],
      removed: ['a', 'c'],
    });
    expect(linkDiff(null, ['a', 'a'])).toEqual({ added: ['a'], removed: [] });
    expect(linkDiff(['a'], undefined)).toEqual({ added: [], removed: ['a'] });
    expect(linkDiff(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] });
  });
});

describe('twoWayWrites', () => {
  // Tasks.Project (p-project) pairs with Projects.Tasks (p-tasks).
  const tasks = relation('p-tasks', 'db-tasks', false, 'p-project');

  it('adds the source row to newly linked rows and takes it off unlinked ones', () => {
    const read = cells({ P1: ['T1', 'T9'], P2: ['T9'], P3: [] });
    const writes = twoWayWrites('T1', linkDiff(['P1'], ['P2', 'P3']), tasks, read);
    expect(writes).toEqual([
      { rowId: 'P1', propertyId: 'p-tasks', value: ['T9'] },
      { rowId: 'P2', propertyId: 'p-tasks', value: ['T9', 'T1'] },
      { rowId: 'P3', propertyId: 'p-tasks', value: ['T1'] },
    ]);
  });

  it('clears a cell that loses its last link and skips cells that already match', () => {
    const read = cells({ P1: ['T1'], P2: ['T1'] });
    const writes = twoWayWrites('T1', { added: ['P2'], removed: ['P1'] }, tasks, read);
    expect(writes).toEqual([{ rowId: 'P1', propertyId: 'p-tasks', value: null }]);
    expect(twoWayWrites('T1', { added: [], removed: ['P3'] }, tasks, cells({}))).toEqual([]);
  });

  it('replaces the old link when the other side allows one row only, and unlinks it back', () => {
    // Agents.Desk (p-desk, many) pairs with Desks.Agent (p-agent, one row only).
    const agentSide = relation('p-agent', 'db-agents', true, 'p-desk');
    const desks = cells({ D1: ['A2'] });
    const agentsDesks = cells({ A2: ['D1', 'D7'] });
    expect(
      twoWayWrites('A1', { added: ['D1'], removed: [] }, agentSide, desks, agentsDesks),
    ).toEqual([
      { rowId: 'D1', propertyId: 'p-agent', value: ['A1'] },
      { rowId: 'A2', propertyId: 'p-desk', value: ['D7'] },
    ]);
    expect(twoWayWrites('A1', { added: ['D1'], removed: [] }, agentSide, desks)).toEqual([
      { rowId: 'D1', propertyId: 'p-agent', value: ['A1'] },
    ]);
  });

  it("leaves the source row's own cell to the caller when a relation is its own pair", () => {
    // Reviews.Related (p-related) is its own two-way pair inside one database.
    const related = relation('p-related', 'db-reviews', false, 'p-related');
    const read = cells({ R2: [], R3: ['R1'] });
    expect(twoWayWrites('R1', { added: ['R2', 'R1'], removed: ['R3'] }, related, read)).toEqual([
      { rowId: 'R3', propertyId: 'p-related', value: null },
      { rowId: 'R2', propertyId: 'p-related', value: ['R1'] },
    ]);
  });
});

describe('backLinks', () => {
  it('collects, per target row, the rows that link to it, in row order', () => {
    const rows = [
      row('T1', { 'p-project': ['P1', 'P2', 'P1'] }),
      row('T2', { 'p-project': null }),
      row('T3', { 'p-project': ['P2', ''] }),
      row('T4', { 'p-project': 'P1' }),
    ];
    expect([...backLinks(rows, 'p-project')]).toEqual([
      ['P1', ['T1']],
      ['P2', ['T1', 'T3']],
    ]);
  });
});

describe('duplicating a database', () => {
  const name: Property = {
    id: 'p-name',
    name: 'Name',
    description: '',
    config: { type: 'title' },
    rowPage: 'always',
  };
  const parent = relation('p-parent', 'db-src', false, 'p-children');
  const children = relation('p-children', 'db-src', false, 'p-parent');
  const project = relation('p-project', 'db-projects', true, 'p-tasks');
  const oneWay = relation('p-desk', 'db-desks', false, null);

  it('points relations to itself at the copy and makes two-way links to others one-way', () => {
    const out = duplicateRelations([name, parent, children, project, oneWay], 'db-src', 'db-copy');
    expect(out.sameDatabaseRelationIds).toEqual(['p-parent', 'p-children']);
    expect(out.properties.map((p) => p.config)).toEqual([
      { type: 'title' },
      {
        type: 'relation',
        targetDatabaseId: 'db-copy',
        single: false,
        twoWayPropertyId: 'p-children',
      },
      {
        type: 'relation',
        targetDatabaseId: 'db-copy',
        single: false,
        twoWayPropertyId: 'p-parent',
      },
      { type: 'relation', targetDatabaseId: 'db-projects', single: true, twoWayPropertyId: null },
      { type: 'relation', targetDatabaseId: 'db-desks', single: false, twoWayPropertyId: null },
    ]);
    expect(out.properties[0]).not.toBe(name);
    expect(parent.config.targetDatabaseId).toBe('db-src');
  });

  it("points links inside the database at the copies and drops rows that weren't copied", () => {
    const idMap = new Map([
      ['T1', 'C1'],
      ['T2', 'C2'],
    ]);
    const values = {
      'p-parent': ['T2', 'T9', 'T2'],
      'p-children': ['T9'],
      'p-project': ['P1'],
      'p-notes': { blocks: ['x'] },
      'p-type': null,
    };
    const out = remapForDuplicate(values, idMap, ['p-parent', 'p-children']);
    expect(out).toEqual({ 'p-parent': ['C2'], 'p-project': ['P1'], 'p-notes': { blocks: ['x'] } });
    expect(out['p-notes']).not.toBe(values['p-notes']);
  });

  it('keeps This page in template presets', () => {
    const out = remapForDuplicate({ 'p-parent': [THIS_PAGE, 'T1'] }, new Map([['T1', 'C1']]), [
      'p-parent',
    ]);
    expect(out).toEqual({ 'p-parent': [THIS_PAGE, 'C1'] });
  });
});

describe("rows the viewer can't open", () => {
  it('splits links into the ones they can open and a count of the rest', () => {
    const open = new Set(['P1', 'P3']);
    expect(visibleLinks(['P1', 'P2', 'P3', 'P4'], (id) => open.has(id))).toEqual({
      visible: ['P1', 'P3'],
      hiddenCount: 2,
    });
    expect(visibleLinks(null, () => true)).toEqual({ visible: [], hiddenCount: 0 });
  });

  it('labels them without titles', () => {
    expect(hiddenRowsLabel(1)).toBe("1 row you can't open");
    expect(hiddenRowsLabel(3)).toBe("3 rows you can't open");
    expect(hiddenRowsLabel(0)).toBe('');
    expect(hiddenRowsLabel(-2)).toBe('');
  });
});
