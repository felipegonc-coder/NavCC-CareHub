import { describe, expect, it } from 'vitest';
import { checkPlan, ImportFileError, type ImportInput } from '../plan';
import { asanaImporter, asanaPlan, NOT_ASANA } from './index';
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
  'Completed',
];
const task = (cells: Partial<Record<string, string>>) => HEADER.map((name) => cells[name] ?? '');

// A fictional project: a task with two subtasks, one of them under a parent not in the file.
const records = [
  HEADER,
  task({
    'Task ID': '11',
    'Created At': '2026-10-01',
    'Last Modified': '2026-10-02',
    Name: 'Intake for Rowan Diaz',
    'Section/Column': 'This week',
    Assignee: 'Avery Lin',
    'Assignee Email': 'avery.lin@example.test',
    'Due Date': '2026-10-30',
    Tags: 'Phone,Urgent',
    Notes: 'Ask about *Tuesday*.\n- Bring the form.',
    Priority: 'High',
    Completed: 'Yes',
  }),
  task({
    'Task ID': '12',
    Name: 'Send forms',
    'Section/Column': 'This week',
    Assignee: 'Lin, Sam',
    'Parent task': 'Intake for Rowan Diaz',
  }),
  task({ 'Task ID': '13', Name: 'Follow up', 'Section/Column': 'Later', 'Parent task': 'Visit' }),
];

const input = (fileName: string, text: string): ImportInput => ({
  fileName,
  bytes: new Uint8Array(),
  text: () => Promise.resolve(text),
  zip: null,
  options: {},
});

const csv = (rows: readonly (readonly string[])[]) =>
  rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');

describe('asanaPlan', () => {
  it('makes a database with a row per task and a Parent task relation (IE-08)', () => {
    const project = readAsanaCsv(records);
    if (!project) throw new Error('not read');
    const plan = asanaPlan(project, 'exports/Care team.csv');
    expect(plan.pages).toEqual([]);
    expect(plan.databases).toEqual([
      {
        key: 'project-1',
        parent: null,
        title: 'Care team',
        columns: [
          { name: 'Name', type: 'text' },
          { name: 'Section', type: 'select' },
          { name: 'Assignee', type: 'person' },
          { name: 'Due date', type: 'date' },
          { name: 'Tags', type: 'multi_select' },
          { name: 'Parent task', type: 'relation' },
          { name: 'Priority', type: null },
          { name: 'Completed', type: null },
        ],
        rows: [
          {
            key: 'task-1',
            cells: [
              'Intake for Rowan Diaz',
              'This week',
              'avery.lin@example.test',
              '2026-10-30',
              'Phone, Urgent',
              '',
              'High',
              'Yes',
            ],
            content: { markdown: 'Ask about \\*Tuesday\\*.\\\n\\- Bring the form.' },
            created: '2026-10-01',
            updated: '2026-10-02',
          },
          {
            key: 'task-2',
            cells: ['Send forms', 'This week', 'Lin Sam', '', '', 'task-1', '', ''],
          },
          { key: 'task-3', cells: ['Follow up', 'Later', '', '', '', '', '', ''] },
        ],
        source: 'exports/Care team.csv',
      },
    ]);
    expect(plan.problems).toEqual([
      {
        file: 'exports/Care team.csv: Row 4',
        what: 'Not linked',
        why: `Its parent task "Visit" isn't in this file.`,
      },
    ]);
    expect(checkPlan(plan)).toHaveLength(1);
  });

  it("keeps the project's fields apart from its own columns, and its columns within the limit", () => {
    const header = ['Name', 'Assignee', 'Due Date', 'Completed At', 'Completed'];
    const extra = Array.from({ length: 200 }, (_, i) => `Field ${i + 1}`);
    const row = ['Visit', '', '', '2026-10-03', 'Yes', ...extra.map(() => 'x')];
    const project = readAsanaCsv([[...header, ...extra], row]);
    if (!project) throw new Error('not read');
    const plan = asanaPlan(project, 'visits.csv');
    const names = plan.databases[0]?.columns.map((column) => column.name) ?? [];
    expect(names.slice(0, 4)).toEqual(['Name', 'Completed', 'Completed 2', 'Field 1']);
    expect(names).toHaveLength(200);
    expect(plan.problems).toEqual([
      {
        file: 'visits.csv',
        what: 'Left out',
        why: "Databases can have up to 200 columns, so the project's last 3 weren't brought in.",
      },
    ]);
    expect(checkPlan(plan)).toHaveLength(1);
  });

  it('stops at once for more tasks than a database holds', () => {
    const project = readAsanaCsv(records);
    if (!project) throw new Error('not read');
    const [first] = project.tasks;
    if (!first) throw new Error('no tasks');
    const many = { ...project, tasks: Array.from({ length: 20_001 }, () => first) };
    expect(() => asanaPlan(many, 'big.csv')).toThrow('databases can have up to 20,000 rows');
  });
});

describe('asanaImporter', () => {
  it("reads the file's CSV", async () => {
    const plan = await asanaImporter.plan(input('Care team.csv', `\uFEFF${csv(records)}\r\n`));
    const project = readAsanaCsv(records);
    if (!project) throw new Error('not read');
    expect(plan).toEqual(asanaPlan(project, 'Care team.csv'));
    expect(asanaImporter.source).toBe('asana');
  });

  it("stops when the file isn't an Asana project's CSV export", async () => {
    for (const text of ['', 'Name,Email\nAvery Lin,avery.lin@example.test', 'Name\n"Visit']) {
      const error = await asanaImporter.plan(input('people.csv', text)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ImportFileError);
    }
    const error = await asanaImporter
      .plan(input('people.csv', 'Name,Email'))
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe(NOT_ASANA);
  });
});
