// Reading an Asana project's CSV export (Import and export spec, section 3.2; IE-08): each task
// with its section, assignee, dates, tags, notes and parent task, and the project's own columns
// (its custom fields) as they are. The tasks become a database with a Parent task relation.

/** Asana's columns, by what they hold; matched without regard to case. */
const COLUMNS = {
  id: 'task id',
  created: 'created at',
  completed: 'completed at',
  modified: 'last modified',
  name: 'name',
  section: 'section/column',
  assignee: 'assignee',
  email: 'assignee email',
  start: 'start date',
  due: 'due date',
  tags: 'tags',
  notes: 'notes',
  projects: 'projects',
  parent: 'parent task',
  blockedBy: 'blocked by (dependencies)',
  blocking: 'blocking (dependencies)',
} as const;
type Column = keyof typeof COLUMNS;

export interface AsanaTask {
  /** Asana's Task ID, or `row <n>` when the file has none. */
  id: string;
  name: string;
  section: string | null;
  assignee: { name: string; email: string | null } | null;
  /** Dates as YYYY-MM-DD, or null. */
  created: string | null;
  start: string | null;
  due: string | null;
  completed: string | null;
  tags: string[];
  notes: string;
  /** The parent task's id, when the parent is in the file. */
  parentId: string | null;
  /** The project's own columns (custom fields) that have a value, by column name. */
  fields: Record<string, string>;
}

export interface AsanaProblem {
  /** The record's number in the file, the header row being 1. */
  row: number;
  message: string;
}

export interface AsanaProject {
  tasks: AsanaTask[];
  /** The project's own columns, in file order. */
  fields: string[];
  /** The sections, in the order they first come. */
  sections: string[];
  problems: AsanaProblem[];
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

function readDate(value: string): string | null | undefined {
  if (!value) return null;
  const match = DATE.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCMonth() === Number(month) - 1 ? `${year}-${month}-${day}` : undefined;
}

/**
 * The tasks in an Asana CSV export (project → Export → CSV), from its parsed records (header row
 * first), or null when it isn't one.
 */
export function readAsanaCsv(records: readonly (readonly string[])[]): AsanaProject | null {
  const [header, ...rows] = records;
  if (!header) return null;
  const index = new Map<Column, number>();
  const fields: { name: string; at: number }[] = [];
  const known = new Map<string, Column>(
    Object.entries(COLUMNS).map(([key, name]) => [name, key as Column]),
  );
  header.forEach((name, at) => {
    const column = known.get(name.trim().toLowerCase());
    if (column && !index.has(column)) index.set(column, at);
    else if (!column && name.trim()) fields.push({ name: name.trim(), at });
  });
  const asana = (['id', 'section', 'assignee', 'due', 'parent'] as const).filter((column) =>
    index.has(column),
  );
  if (!index.has('name') || asana.length < 2) return null;

  const problems: AsanaProblem[] = [];
  const sections: string[] = [];
  const tasks: AsanaTask[] = [];
  const parents = new Map<AsanaTask, { value: string; row: number }>();
  rows.forEach((cells, at) => {
    const row = at + 2;
    if (cells.every((cell) => !cell.trim())) return;
    const raw = (column: Column) => {
      const i = index.get(column);
      return i === undefined ? '' : (cells[i] ?? '');
    };
    const cell = (column: Column) => raw(column).trim();
    const date = (column: Column, label: string) => {
      const read = readDate(cell(column));
      if (read !== undefined) return read;
      problems.push({
        row,
        message: `${label} “${cell(column)}” isn't a date, so it was left empty.`,
      });
      return null;
    };
    const section = cell('section') || null;
    if (section && !sections.includes(section)) sections.push(section);
    const assignee = cell('assignee');
    const email = cell('email');
    const task: AsanaTask = {
      id: cell('id') || `row ${row}`,
      name: cell('name') || 'Untitled',
      section,
      assignee: assignee || email ? { name: assignee || email, email: email || null } : null,
      created: date('created', 'Created At'),
      start: date('start', 'Start Date'),
      due: date('due', 'Due Date'),
      completed: date('completed', 'Completed At'),
      tags: [
        ...new Set(
          cell('tags')
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ],
      notes: raw('notes'),
      parentId: null,
      fields: Object.fromEntries(
        fields
          .map(({ name, at: i }) => [name, (cells[i] ?? '').trim()] as const)
          .filter(([, value]) => value),
      ),
    };
    tasks.push(task);
    const parent = cell('parent');
    if (parent) parents.set(task, { value: parent, row });
  });

  // The parent is named by its Task ID or by its name; a name must be one task's only.
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const byName = new Map<string, AsanaTask[]>();
  for (const task of tasks) byName.set(task.name, [...(byName.get(task.name) ?? []), task]);
  for (const [task, { value, row }] of parents) {
    const named = byName.get(value) ?? [];
    const parent = byId.get(value) ?? (named.length === 1 ? named[0] : undefined);
    if (!parent) {
      problems.push({
        row,
        message:
          named.length > 1
            ? `${named.length} tasks are called “${value}”, so its parent task wasn't set.`
            : `Its parent task “${value}” isn't in this file.`,
      });
    } else if (closesLoop(task, parent, byId)) {
      problems.push({
        row,
        message: `“${value}” is already under it, so it wasn't made its parent.`,
      });
    } else {
      task.parentId = parent.id;
    }
  }
  problems.sort((a, b) => a.row - b.row);
  return { tasks, fields: fields.map(({ name }) => name), sections, problems };
}

/** Whether making `parent` the parent of `task` would put a task under itself. */
function closesLoop(task: AsanaTask, parent: AsanaTask, byId: Map<string, AsanaTask>): boolean {
  const seen = new Set<AsanaTask>();
  for (let at: AsanaTask | undefined = parent; at; at = byId.get(at.parentId ?? '')) {
    if (at === task) return true;
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return false;
}
