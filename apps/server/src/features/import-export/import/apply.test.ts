import { ImportFileError, type ImportPlan } from '@carehub/extras/import-export/import/index';
import { afterEach, describe, expect, it } from 'vitest';
import type { Tx } from '../../../db';
import { bindHistoryContent } from '../../history/content';
import { bindHistoryPages } from '../../history/pages';
import { applyPlan, type ImportTarget } from './apply';
import {
  bindImportPorts,
  type ImportedDates,
  type NewImportDatabase,
  type RowLinks,
} from './ports';

const tx = {} as Tx;
const userId = '00000000-0000-4000-8000-0000000000aa';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const into: ImportTarget = { workspaceId: id(900), pageId: id(901), spaceId: null };
const privately: ImportTarget = { workspaceId: id(900), pageId: null, spaceId: id(902) };

interface Made {
  id: string;
  kind: string;
  title: string;
  parentId: string | null;
  spaceId: string | null;
}

let unbind: (() => void)[] = [];
afterEach(() => {
  for (const undo of unbind.reverse()) undo();
  unbind = [];
});

/** Fake page model, content and files, recording what the import writes and in what order. */
function fakes(options: { refuseFiles?: boolean } = {}) {
  const made: Made[] = [];
  const databases: NewImportDatabase[] = [];
  const content = new Map<string, unknown>();
  const log: string[] = [];
  let next = 0;
  unbind.push(
    bindImportPorts({
      createPage: async (_tx, page) => {
        const pageId = id(++next);
        made.push({ id: pageId, kind: 'page', ...pick(page) });
        log.push(`page ${page.title}`);
        return { id: pageId };
      },
      createDatabase: async (_tx, database) => {
        const databaseId = id(++next);
        made.push({ id: databaseId, kind: 'database', ...pick(database) });
        databases.push(database);
        log.push(`database ${database.title}`);
        return { id: databaseId, rowIds: database.rows.map(() => id(++next)) };
      },
      setMarkdown: async (_tx, pageId, markdown) => void content.set(pageId, markdown),
      setDoc: async (_tx, pageId, doc) => void content.set(pageId, doc),
      saveFile: async (_tx, file) => {
        log.push(`file ${file.name}`);
        if (options.refuseFiles) throw new ImportFileError("files can't be imported yet");
        return { id: 'file', url: `/api/files/${file.name}` };
      },
    }),
  );
  return { made, databases, content, log };
}

const pick = (page: { title: string; parentId: string | null; spaceId: string | null }) => ({
  title: page.title,
  parentId: page.parentId,
  spaceId: page.spaceId,
});

const emptyPlan: ImportPlan = { pages: [], databases: [], files: [], problems: [] };

describe('applyPlan', () => {
  it('makes pages parent first, then fills them with links pointed at the new pages and files', async () => {
    const { made, content, log } = fakes();
    const progress: [number, number][] = [];
    const plan: ImportPlan = {
      pages: [
        {
          key: 'p2',
          parent: 'p1',
          title: 'Escalation steps',
          content: { markdown: 'Back to [Intake](carehub-import:p1).' },
          source: 'Intake/Escalation steps.md',
        },
        {
          key: 'p1',
          parent: null,
          title: 'Intake',
          content: {
            markdown: 'Read [Escalation steps](carehub-import:p2).\n\n![Desk](carehub-import:f1)',
          },
          source: 'Intake.md',
        },
      ],
      databases: [],
      files: [{ key: 'f1', name: 'desk.png' }],
      problems: [{ file: 'notes.bin', what: 'Skipped', why: 'No page links to it.' }],
    };
    const result = await applyPlan(tx, {
      userId,
      source: 'markdown',
      target: into,
      plan,
      files: [new Uint8Array([1, 2, 3])],
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(log).toEqual(['file desk.png', 'page Intake', 'page Escalation steps']);
    expect(made).toEqual([
      { id: id(1), kind: 'page', title: 'Intake', parentId: into.pageId, spaceId: null },
      { id: id(2), kind: 'page', title: 'Escalation steps', parentId: id(1), spaceId: null },
    ]);
    expect(content.get(id(1))).toBe(
      `Read [Escalation steps](/p/${id(2)}).\n\n![Desk](/api/files/desk.png)`,
    );
    expect(content.get(id(2))).toBe(`Back to [Intake](/p/${id(1)}).`);
    expect(result).toEqual({
      items: [
        { pageId: id(1), parentId: null, kind: 'page', title: 'Intake' },
        { pageId: id(2), parentId: id(1), kind: 'page', title: 'Escalation steps' },
      ],
      counts: { pages: 2, databases: 0, rows: 0, files: 1 },
      problems: plan.problems,
      problemCount: 1,
    });
    expect(progress.at(-1)).toEqual([2, 2]);
  });

  it('puts top pages in the Private space, and makes databases with their rows', async () => {
    const { made, content } = fakes();
    const result = await applyPlan(tx, {
      userId,
      source: 'csv',
      target: privately,
      files: [],
      plan: {
        ...emptyPlan,
        databases: [
          {
            key: 'd1',
            parent: null,
            title: 'Clinics',
            columns: [
              { name: 'Name', type: null },
              { name: 'City', type: 'text' },
            ],
            rows: [
              { key: 'r1', cells: ['Northside', 'Denver'], content: { markdown: 'Open late.' } },
              { key: 'r2', cells: ['Eastside', 'Aurora'] },
            ],
            source: 'Clinics.csv',
          },
        ],
        pages: [
          {
            key: 'p1',
            parent: 'r2',
            title: 'Parking',
            content: { markdown: 'As at [Northside](carehub-import:r1).' },
            source: 'Parking.md',
          },
        ],
      },
    });
    expect(made).toEqual([
      { id: id(1), kind: 'database', title: 'Clinics', parentId: null, spaceId: privately.spaceId },
      { id: id(4), kind: 'page', title: 'Parking', parentId: id(3), spaceId: null },
    ]);
    expect(content.get(id(2))).toBe('Open late.');
    expect(content.get(id(4))).toBe(`As at [Northside](/p/${id(2)}).`);
    expect(result.items).toEqual([
      { pageId: id(1), parentId: null, kind: 'database', title: 'Clinics' },
      { pageId: id(2), parentId: id(1), kind: 'row', title: 'Northside' },
      { pageId: id(3), parentId: id(1), kind: 'row', title: 'Eastside' },
      { pageId: id(4), parentId: id(3), kind: 'page', title: 'Parking' },
    ]);
    expect(result.counts).toEqual({ pages: 1, databases: 1, rows: 2, files: 0 });
  });

  it('lists files it could not save and content that is not valid, and keeps going', async () => {
    const { content } = fakes({ refuseFiles: true });
    const result = await applyPlan(tx, {
      userId,
      source: 'markdown',
      target: into,
      files: [new Uint8Array([1])],
      plan: {
        ...emptyPlan,
        files: [{ key: 'f1', name: 'desk.png' }],
        pages: [
          {
            key: 'p1',
            parent: null,
            title: 'Desk',
            content: { markdown: '![The desk](carehub-import:f1)' },
            source: 'Desk.md',
          },
          {
            key: 'p2',
            parent: null,
            title: 'Frame',
            content: { doc: { type: 'doc', content: [{ type: 'iframe' }] } },
            source: 'Frame.html',
          },
        ],
      },
    });
    expect(content.get(id(1))).toBe('The desk');
    expect(content.has(id(2))).toBe(false);
    expect(result.problems).toEqual([
      { file: 'desk.png', what: 'Skipped', why: "Files can't be imported yet." },
      { file: 'Frame.html', what: 'Left empty', why: "Its content couldn't be read." },
    ]);
    expect(result.counts.files).toBe(0);
  });

  it('keeps 1,000 problems and counts the rest', async () => {
    fakes({ refuseFiles: true });
    const problems = Array.from({ length: 1_000 }, (_, n) => ({
      file: `${n}.bin`,
      what: 'Skipped',
      why: 'No page links to it.',
    }));
    const result = await applyPlan(tx, {
      userId,
      source: 'markdown',
      target: into,
      files: [new Uint8Array([1])],
      plan: { ...emptyPlan, files: [{ key: 'f1', name: 'desk.png' }], problems },
    });
    expect(result.problems).toHaveLength(1_000);
    expect(result.problemCount).toBe(1_001);
  });

  it('saves a version of the page it goes under before anything else (HT-02)', async () => {
    const { log } = fakes();
    unbind.push(
      bindHistoryPages({
        getPage: async (_db, pageId) => {
          log.push(`version ${pageId}`);
          return null;
        },
      }),
      bindHistoryContent({
        getPageContent: async () => ({ type: 'doc', content: [] }),
        setPageContent: async () => {},
      }),
    );
    const plan: ImportPlan = {
      ...emptyPlan,
      pages: [
        {
          key: 'p1',
          parent: null,
          title: 'Intake',
          content: { markdown: '' },
          source: 'Intake.md',
        },
      ],
    };
    await applyPlan(tx, { userId, source: 'markdown', target: into, files: [], plan });
    expect(log).toEqual([`version ${into.pageId}`, 'page Intake']);
  });

  it('stops when it is cancelled', async () => {
    const { made } = fakes();
    const cancel = new AbortController();
    const plan: ImportPlan = {
      ...emptyPlan,
      pages: [
        { key: 'p1', parent: null, title: 'One', content: { markdown: 'One' }, source: 'One.md' },
        { key: 'p2', parent: null, title: 'Two', content: { markdown: 'Two' }, source: 'Two.md' },
      ],
    };
    await expect(
      applyPlan(tx, {
        userId,
        source: 'markdown',
        target: into,
        files: [],
        plan,
        signal: cancel.signal,
        onProgress: () => cancel.abort(),
      }),
    ).rejects.toThrow();
    expect(made.map((page) => page.title)).toEqual(['One']);
  });

  it('refuses a plan that is not consistent before writing anything', async () => {
    const { made } = fakes();
    const plan: ImportPlan = {
      ...emptyPlan,
      pages: [
        { key: 'p1', parent: 'p9', title: 'Lost', content: { markdown: '' }, source: 'Lost.md' },
      ],
    };
    await expect(
      applyPlan(tx, { userId, source: 'markdown', target: into, files: [], plan }),
    ).rejects.toThrow(ImportFileError);
    expect(made).toEqual([]);
  });

  it('matches people to members, links rows to rows once they are made, and keeps the board', async () => {
    const { databases } = fakes();
    const asked: string[][] = [];
    const linked: RowLinks[] = [];
    unbind.push(
      bindImportPorts({
        findMembers: async (_db, workspaceId, texts) => {
          expect(workspaceId).toBe(into.workspaceId);
          asked.push([...texts]);
          return [
            { userId: id(801), email: 'Avery@Example.test', name: 'Avery Kim' },
            { userId: id(802), email: 'jordan@example.test', name: 'Jordan Lee' },
            { userId: id(803), email: 'sam.o@example.test', name: 'Sam Ortiz' },
            { userId: id(804), email: 'sam.ortiz@example.test', name: 'Sam Ortiz' },
          ];
        },
        timeZoneOf: async () => 'Europe/Lisbon',
        linkRows: async (_tx, links) => void linked.push(links),
      }),
    );
    const result = await applyPlan(tx, {
      userId,
      source: 'asana',
      target: into,
      files: [],
      plan: {
        ...emptyPlan,
        databases: [
          {
            key: 'd1',
            parent: null,
            title: 'Front desk',
            columns: [
              { name: 'Name', type: null },
              { name: 'Section', type: 'select' },
              { name: 'Assignee', type: 'person' },
              { name: 'Parent task', type: 'relation' },
            ],
            rows: [
              { key: 'r1', cells: ['Call Rowan', 'To do', 'avery@example.test, Sam Ortiz', ''] },
              { key: 'r2', cells: ['Book room', 'Doing', 'Jordan Lee, Avery Kim', 'r1'] },
              { key: 'r3', cells: ['Order cups', 'To do', 'rowan@example.test', 'r1, r9, r1'] },
            ],
            source: 'Front desk.csv',
            view: { layout: 'board', groupBy: 'Section' },
          },
        ],
      },
    });
    expect(asked).toEqual([
      ['avery@example.test', 'Sam Ortiz', 'Jordan Lee', 'Avery Kim', 'rowan@example.test'],
    ]);
    expect(databases[0]).toMatchObject({
      rows: [
        ['Call Rowan', 'To do', id(801), ''],
        ['Book room', 'Doing', `${id(802)}, ${id(801)}`, ''],
        ['Order cups', 'To do', '', ''],
      ],
      view: { layout: 'board', groupBy: 'Section' },
      timeZone: 'Europe/Lisbon',
    });
    expect(linked).toEqual([
      {
        databaseId: id(1),
        column: 'Parent task',
        links: [
          { rowId: id(3), to: [id(2)] },
          { rowId: id(4), to: [id(2)] },
        ],
      },
    ]);
    expect(result.problems).toEqual([
      {
        file: 'Front desk.csv',
        what: 'Left out',
        why: 'More than one member is called "Sam Ortiz".',
      },
      {
        file: 'Front desk.csv',
        what: 'Left out',
        why: 'No member has the name or email "rowan@example.test".',
      },
      { file: 'Front desk.csv', what: 'Left out', why: "A linked row isn't in the import." },
    ]);
  });

  it("keeps the source's dates in Updates, reading times without a zone in the person's", async () => {
    const { databases } = fakes();
    const notes: ImportedDates[][] = [];
    unbind.push(
      bindImportPorts({
        timeZoneOf: async () => 'America/New_York',
        noteImported: async (_tx, dates) => void notes.push([...dates]),
      }),
    );
    await applyPlan(tx, {
      userId,
      source: 'evernote',
      target: into,
      files: [],
      plan: {
        ...emptyPlan,
        pages: [
          {
            key: 'p1',
            parent: null,
            title: 'Trip',
            content: { markdown: 'Bring maps.' },
            source: 'Notes.enex',
            created: '2021-03-03T10:15:00',
            updated: '2021-03-04',
          },
          {
            key: 'p2',
            parent: null,
            title: 'Undated',
            content: { markdown: '' },
            source: 'Notes.enex',
            created: 'last spring',
          },
        ],
        databases: [
          {
            key: 'd1',
            parent: null,
            title: 'Notes',
            columns: [{ name: 'Name', type: null }],
            rows: [{ key: 'r1', cells: ['Shopping'], updated: '2021-03-05T09:00:00+01:00' }],
            source: 'Notes.enex',
          },
        ],
      },
    });
    expect(notes).toEqual([
      [
        {
          pageId: id(1),
          source: 'evernote',
          created: '2021-03-03T15:15:00.000Z',
          updated: '2021-03-04',
          by: userId,
        },
        { pageId: id(4), source: 'evernote', updated: '2021-03-05T08:00:00.000Z', by: userId },
      ],
    ]);
    expect(databases[0]?.timeZone).toBe('America/New_York');
    expect(databases[0]?.view).toBeUndefined();
  });
});
