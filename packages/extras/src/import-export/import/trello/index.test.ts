import { describe, expect, it } from 'vitest';
import { checkPlan, ImportFileError, type ImportInput } from '../plan';
import { TOO_MUCH_TEXT } from '../writer/plan-writer';
import { trelloImporter, trelloPlan } from './index';
import { readTrelloBoard, type TrelloBoard, type TrelloCard } from './read';

/** What `run` throws, to check both its class and its message. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectStop(error: unknown, reason: string) {
  expect(error).toBeInstanceOf(ImportFileError);
  expect((error as Error).message).toBe(reason);
}

// The importer reads the file's text, so the bytes aren't needed.
const input = (fileName: string, text: string, options = {}): ImportInput => ({
  fileName,
  bytes: new Uint8Array(),
  text: () => Promise.resolve(text),
  zip: null,
  options,
});

// A fictional board: two open lists and an archived one.
const board = {
  name: 'Intake board',
  lists: [
    { id: 'l1', name: 'To do', pos: 1 },
    { id: 'l2', name: 'Done', pos: 2 },
    { id: 'l3', name: 'Old', closed: true, pos: 3 },
  ],
  labels: [
    { id: 'a', name: 'Urgent', color: 'red' },
    { id: 'b', name: 'Calls, follow-ups', color: 'blue' },
  ],
  members: [
    { id: 'm1', fullName: 'Avery Lin', username: 'averylin' },
    { id: 'm2', fullName: 'Sam Ortiz', username: 'samortiz' },
  ],
  cards: [
    {
      id: 'c1',
      name: 'Call Rowan Diaz',
      desc: 'Ask about **Tuesday**.',
      idList: 'l1',
      pos: 1,
      idLabels: ['a', 'b'],
      idMembers: ['m1', 'm2'],
      due: '2026-10-30T17:00:00.000Z',
      dueComplete: false,
      attachments: [{ name: 'Visit notes (draft)', url: 'https://example.test/visit notes' }],
    },
    { id: 'c2', name: 'Send forms', idList: 'l2', pos: 1 },
    { id: 'c3', name: 'Archived card', idList: 'l1', pos: 2, closed: true },
    { id: 'c4', name: 'In an archived list', idList: 'l3', pos: 1 },
  ],
  checklists: [
    {
      idCard: 'c1',
      name: 'Before the call',
      pos: 1,
      checkItems: [
        { name: 'Find the *number*', state: 'complete', pos: 1 },
        { name: 'Book a room', state: 'incomplete', pos: 2 },
      ],
    },
  ],
};
const read = () => readTrelloBoard(board) as TrelloBoard;

describe('trelloPlan', () => {
  it('makes a database with a row per card, its list as Status and labels as a multi-select (IE-07)', () => {
    const plan = trelloPlan(read(), 'intake.json');
    expect(plan.pages).toEqual([]);
    expect(plan.files).toEqual([]);
    expect(plan.databases).toEqual([
      {
        key: 'board-1',
        parent: null,
        title: 'Intake board',
        columns: [
          { name: 'Name', type: 'text' },
          { name: 'Status', type: 'status' },
          { name: 'Labels', type: 'multi_select' },
          { name: 'Members', type: 'person' },
          { name: 'Due', type: 'date' },
          { name: 'Due complete', type: 'checkbox' },
        ],
        rows: [
          {
            key: 'card-1',
            cells: [
              'Call Rowan Diaz',
              'To do',
              'Urgent, Calls follow-ups',
              'Avery Lin, Sam Ortiz',
              '2026-10-30T17:00:00.000Z',
              'false',
            ],
            content: {
              markdown: [
                'Ask about **Tuesday**.',
                '',
                '## Before the call',
                '',
                '- [x] Find the \\*number\\*',
                '- [ ] Book a room',
                '',
                '## Attachments',
                '',
                '- [Visit notes (draft)](https://example.test/visit%20notes)',
              ].join('\n'),
            },
          },
          { key: 'card-2', cells: ['Send forms', 'Done', '', '', '', ''] },
        ],
        source: 'intake.json',
        view: { layout: 'board', groupBy: 'Status' },
      },
    ]);
    expect(plan.problems).toEqual([
      { file: 'intake.json', what: 'Left out', why: '2 cards are archived.' },
      {
        file: 'intake.json: Label "Calls, follow-ups"',
        what: 'Renamed',
        why: `Options can't have commas, so it's "Calls follow-ups".`,
      },
    ]);
    expect(checkPlan(plan)).toHaveLength(1);
  });

  it('brings in archived cards, ticked in an Archived column, with Include archived', () => {
    const database = trelloPlan(read(), 'intake.json', { includeArchived: true }).databases[0];
    expect(database?.columns.at(-1)).toEqual({ name: 'Archived', type: 'checkbox' });
    expect(database?.rows.map((row) => [row.cells[0], row.cells.at(-1)])).toEqual([
      ['Call Rowan Diaz', 'false'],
      ['Archived card', 'true'],
      ['Send forms', 'false'],
      ['In an archived list', 'true'],
    ]);
  });

  it('cuts names and fields to their limits, listing each cut', () => {
    const long = read();
    long.name = 'B'.repeat(600);
    long.lists[0] = { id: 'l1', name: 'L'.repeat(150), archived: false };
    const card = long.cards[0] as TrelloCard;
    card.name = 'C'.repeat(600);
    const plan = trelloPlan(long, 'intake.json');
    const database = plan.databases[0];
    expect(database?.title).toHaveLength(500);
    expect(database?.rows[0]?.cells[0]).toHaveLength(500);
    expect(database?.rows[0]?.cells[1]).toHaveLength(100);
    expect(plan.problems.map((problem) => problem.why)).toEqual([
      '2 cards are archived.',
      'Only the first 100 characters were kept.',
      `Options can't have commas, so it's "Calls follow-ups".`,
      'Only the first 500 characters were kept.',
      'Only the first 500 characters were kept.',
    ]);
  });

  it('stops at once for more cards than a database holds, or more than 10 MB of text', () => {
    const cards = (count: number, description = ''): TrelloCard[] =>
      Array.from({ length: count }, (_, i) => ({
        id: `c${i}`,
        name: `Card ${i}`,
        description,
        listId: 'l1',
        archived: false,
        labelIds: [],
        memberIds: [],
        start: null,
        due: null,
        dueComplete: false,
        checklists: [],
        attachments: [],
      }));
    const empty: TrelloBoard = { name: 'Big', lists: [], labels: [], members: [], cards: [] };
    const started = Date.now();
    expectStop(
      thrown(() => trelloPlan({ ...empty, cards: cards(20_001) }, 'big.json')),
      'databases can have up to 20,000 rows',
    );
    expectStop(
      thrown(() => trelloPlan({ ...empty, cards: cards(11, 'x'.repeat(1_000_000)) }, 'big.json')),
      TOO_MUCH_TEXT,
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('trelloImporter', () => {
  it("reads the file's JSON, with archived cards only when they're asked for", async () => {
    const plan = await trelloImporter.plan(input('intake.json', JSON.stringify(board)));
    expect(plan).toEqual(trelloPlan(read(), 'intake.json'));
    expect(trelloImporter.source).toBe('trello');
    const all = { includeArchived: true };
    const archived = await trelloImporter.plan(input('intake.json', JSON.stringify(board), all));
    expect(archived).toEqual(trelloPlan(read(), 'intake.json', all));
  });

  it("stops when the file isn't a Trello board's JSON export", async () => {
    for (const text of ['{"name": "Intake', '[]', '{"name": "Notes", "pages": []}']) {
      const error = await trelloImporter.plan(input('notes.json', text)).catch((e: unknown) => e);
      expectStop(error, "the file isn't a Trello board's JSON export");
    }
  });
});
