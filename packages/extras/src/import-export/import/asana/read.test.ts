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
        start: null,
        due: '2026-10-30',
        completed: null,
        tags: ['Phone', 'Urgent'],
        notes: 'Ask about Tuesday.\nBring the form.',
        parentId: null,
        fields: { Priority: 'High' },
      },
      {
        id: '1202',
        name: 'Book a room',
        section: 'Later',
        assignee: null,
        created: null,
        start: null,
        due: null,
        completed: null,
        tags: [],
        notes: '',
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
    ]);
    expect(project?.tasks.map((t) => [t.id, t.parentId])).toEqual([
      ['1', null],
      ['2', '1'],
      ['3', '2'],
      ['4', null],
      ['5', null],
      ['6', null],
      ['7', null],
    ]);
    expect(project?.problems).toEqual([
      { row: 5, message: "Its parent task “Discharge” isn't in this file." },
      { row: 7, message: "2 tasks are called “Forms”, so its parent task wasn't set." },
      { row: 8, message: "“7” is already under it, so it wasn't made its parent." },
    ]);
  });

  it('leaves dates it cannot read empty, and lists them', () => {
    const project = readAsanaCsv([
      HEADER,
      task({ Name: 'Visit', 'Due Date': '2026-02-30', 'Start Date': 'soon' }),
    ]);
    expect(project?.tasks[0]).toMatchObject({ id: 'row 2', due: null, start: null });
    expect(project?.problems.map((p) => p.message)).toEqual([
      "Start Date “soon” isn't a date, so it was left empty.",
      "Due Date “2026-02-30” isn't a date, so it was left empty.",
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
