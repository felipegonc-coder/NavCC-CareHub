import { describe, expect, it } from 'vitest';
import { readAsanaCsv } from './read';

const HEADER = [
  'Task ID',
  'Created At',
  'Completed At',
  'Last Modified',
  'Name',
  'Section/Column',
  'Assignee',
  'Assignee Email',
  'Start Date',
  'Due Date',
  'Tags',
  'Notes',
  'Projects',
  'Parent task',
  'Blocked By (Dependencies)',
  'Blocking (Dependencies)',
  'Priority',
];
const task = (cells: Partial<Record<string, string>>) => HEADER.map((name) => cells[name] ?? '');

describe('readAsanaCsv', () => {
  it('reads each task with its section, assignee, dates, tags, notes and own columns', () => {
    const project = readAsanaCsv([
      HEADER,
      task({
        'Task ID': '1201',
        'Created At': '2026-10-01',
        Name: 'Call Rowan Diaz',
        'Section/Column': 'This week',
        Assignee: 'Avery Lin',
        'Assignee Email': 'avery.lin@example.test',
        'Due Date': '2026-10-30',
        Tags: 'Phone, Urgent,Phone',
        Notes: 'Ask about Tuesday.\nBring the form.',
        Priority: 'High',
      }),
      task({ 'Task ID': '1202', Name: 'Book a room', 'Section/Column': 'Later' }),
      ['', '', ''],
    ]);
    expect(project?.sections).toEqual(['This week', 'Later']);
    expect(project?.fields).toEqual(['Priority']);
    expect(project?.problems).toEqual([]);
    expect(project?.tasks).toEqual([
      {
        id: '1201',
        name: 'Call Rowan Diaz',
        section: 'This week',
        assignee: { name: 'Avery Lin', email: 'avery.lin@example.test' },
        created: '2026-10-01',
        updated: null,
        start: null,
        due: '2026-10-30',
        completed: null,
        tags: ['Phone', 'Urgent'],
        notes: 'Ask about Tuesday.\nBring the form.',
        blockedBy: '',
        blocking: '',
        parentId: null,
        fields: { Priority: 'High' },
      },
      {
        id: '1202',
        name: 'Book a room',
        section: 'Later',
        assignee: null,
        created: null,
        updated: null,
        start: null,
        due: null,
        completed: null,
        tags: [],
        notes: '',
        blockedBy: '',
        blocking: '',
        parentId: null,
        fields: {},
      },
    ]);
  });

  it('finds each parent task by its ID or its name, and lists the ones it cannot', () => {
    const project = readAsanaCsv([
      HEADER,
      task({ 'Task ID': '1', Name: 'Intake' }),
      task({ 'Task ID': '2', Name: 'Forms', 'Parent task': 'Intake' }),
      task({ 'Task ID': '3', Name: 'Send forms', 'Parent task': '2' }),
      task({ 'Task ID': '4', Name: 'Follow up', 'Parent task': 'Discharge' }),
      task({ 'Task ID': '5', Name: 'Forms' }),
      task({ 'Task ID': '6', Name: 'Sign', 'Parent task': 'Forms' }),
      task({ 'Task ID': '7', Name: 'Loop', 'Parent task': '7' }),
      task({ 'Task ID': '8', Name: 'Ask', 'Parent task': '9' }),
      task({ 'Task ID': '9', Name: 'Answer', 'Parent task': '8' }),
    ]);
    expect(project?.tasks.map((t) => [t.id, t.parentId])).toEqual([
      ['1', null],
      ['2', '1'],
      ['3', '2'],
      ['4', null],
      ['5', null],
      ['6', null],
      ['7', null],
      ['8', '9'],
      ['9', null],
    ]);
    expect(project?.problems).toEqual([
      { row: 5, what: 'Not linked', why: `Its parent task "Discharge" isn't in this file.` },
      {
        row: 7,
        what: 'Not linked',
        why: '2 tasks are called "Forms", so its parent task isn\'t clear.',
      },
      { row: 8, what: 'Not linked', why: 'It names itself as its parent task.' },
      {
        row: 10,
        what: 'Not linked',
        why: `"8" is under it already, so it can't be its parent too.`,
      },
    ]);
  });

  it('leaves dates it cannot read empty, and lists them', () => {
    const project = readAsanaCsv([
      HEADER,
      task({ Name: 'Visit', 'Due Date': '2026-02-30', 'Start Date': 'soon' }),
    ]);
    expect(project?.tasks[0]).toMatchObject({ id: 'row 2', due: null, start: null });
    expect(project?.problems).toEqual([
      { row: 2, what: 'Left empty', why: `Start Date "soon" isn't a date.` },
      { row: 2, what: 'Left empty', why: `Due Date "2026-02-30" isn't a date.` },
    ]);
  });

  it("says when the file isn't an Asana export", () => {
    expect(readAsanaCsv([])).toBeNull();
    expect(
      readAsanaCsv([
        ['Name', 'Email'],
        ['Avery Lin', 'avery.lin@example.test'],
      ]),
    ).toBeNull();
    expect(readAsanaCsv([['name', 'ASSIGNEE', 'Due date']])).toEqual({
      tasks: [],
      fields: [],
      sections: [],
      problems: [],
    });
  });
});
