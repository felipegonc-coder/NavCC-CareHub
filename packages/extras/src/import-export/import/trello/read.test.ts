import { describe, expect, it } from 'vitest';
import { readTrelloBoard } from './read';

const board = {
  id: 'b1',
  name: 'Intake board',
  closed: false,
  lists: [
    { id: 'l-done', name: 'Done', closed: false, pos: 300 },
    { id: 'l-todo', name: 'To do', closed: false, pos: 100 },
    { id: 'l-old', name: 'Old', closed: true, pos: 200 },
    { name: 'No id' },
  ],
  labels: [
    { id: 'lb1', name: 'Urgent', color: 'red' },
    { id: 'lb2', name: '', color: 'sky_dark' },
    { id: 'lb3', name: 'Later', color: null },
  ],
  members: [{ id: 'm1', fullName: 'Avery Lin', username: 'averylin' }],
  cards: [
    {
      id: 'c2',
      name: 'Send forms',
      desc: '',
      closed: false,
      idList: 'l-done',
      pos: 1,
      idLabels: [],
      idMembers: [],
      due: null,
      dueComplete: false,
    },
    {
      id: 'c1',
      name: 'Call Rowan Diaz',
      desc: 'Ask about **Tuesday**.',
      closed: false,
      idList: 'l-todo',
      pos: 2,
      idLabels: ['lb1', 'lb2', 'lb1'],
      idMembers: ['m1'],
      start: '2026-10-28T15:00:00.000Z',
      due: '2026-10-30T17:00:00.000Z',
      dueComplete: true,
      attachments: [
        { name: 'Visit notes', url: 'https://example.test/notes' },
        { name: 'Script', url: 'javascript:alert(1)' },
        { name: '', url: 'https://example.test/plan.pdf' },
      ],
    },
    {
      id: 'c0',
      name: '  ',
      closed: true,
      idList: 'l-todo',
      pos: 1,
      idLabels: 'not a list',
      dueComplete: 'yes',
    },
    { name: 'No id' },
  ],
  checklists: [
    {
      id: 'k2',
      idCard: 'c1',
      name: 'After the call',
      pos: 2,
      checkItems: [{ name: 'Update the plan', state: 'incomplete', pos: 1 }],
    },
    {
      id: 'k1',
      idCard: 'c1',
      name: '',
      pos: 1,
      checkItems: [
        { name: 'Find the number', state: 'complete', pos: 2 },
        { name: 'Book a room', state: 'incomplete', pos: 1 },
      ],
    },
  ],
};

describe('readTrelloBoard', () => {
  it('reads the lists, labels and members in the board order', () => {
    const read = readTrelloBoard(board);
    expect(read?.name).toBe('Intake board');
    expect(read?.lists).toEqual([
      { id: 'l-todo', name: 'To do', archived: false },
      { id: 'l-old', name: 'Old', archived: true },
      { id: 'l-done', name: 'Done', archived: false },
    ]);
    expect(read?.labels).toEqual([
      { id: 'lb1', name: 'Urgent' },
      { id: 'lb2', name: 'Sky dark' },
      { id: 'lb3', name: 'Later' },
    ]);
    expect(read?.members).toEqual([{ id: 'm1', name: 'Avery Lin' }]);
  });

  it('reads each card with its checklists and web attachments, in list and card order', () => {
    const cards = readTrelloBoard(board)?.cards ?? [];
    expect(cards.map((card) => card.id)).toEqual(['c0', 'c1', 'c2']);
    expect(cards[0]).toMatchObject({
      name: 'Untitled',
      archived: true,
      labelIds: [],
      dueComplete: false,
    });
    expect(cards[1]).toEqual({
      id: 'c1',
      name: 'Call Rowan Diaz',
      description: 'Ask about **Tuesday**.',
      listId: 'l-todo',
      archived: false,
      labelIds: ['lb1', 'lb2'],
      memberIds: ['m1'],
      start: '2026-10-28T15:00:00.000Z',
      due: '2026-10-30T17:00:00.000Z',
      dueComplete: true,
      checklists: [
        {
          name: 'Checklist',
          items: [
            { name: 'Book a room', done: false },
            { name: 'Find the number', done: true },
          ],
        },
        { name: 'After the call', items: [{ name: 'Update the plan', done: false }] },
      ],
      attachments: [
        { name: 'Visit notes', url: 'https://example.test/notes' },
        { name: 'https://example.test/plan.pdf', url: 'https://example.test/plan.pdf' },
      ],
    });
  });

  it("says when the file isn't a Trello board", () => {
    expect(readTrelloBoard(null)).toBeNull();
    expect(readTrelloBoard([board])).toBeNull();
    expect(readTrelloBoard({ name: 'Notes', pages: [] })).toBeNull();
    expect(readTrelloBoard({ name: 'Empty', lists: [], cards: [] })).toEqual({
      name: 'Empty',
      lists: [],
      labels: [],
      members: [],
      cards: [],
    });
  });
});
