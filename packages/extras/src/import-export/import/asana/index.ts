// The Asana importer (Import and export spec, section 3.2; IE-08): a project's CSV export becomes
// one database with a row per task. Its section is a select (options in the project's order), its
// assignee a person (matched to Care Hub's on the server), then its dates and tags, a Parent task
// relation for subtasks, its dependencies and the project's own fields, with the task's notes as
// the row's page.
import {
  IMPORT_LIMITS,
  ImportFileError,
  type ImportPlan,
  type Importer,
  type PlanColumn,
  type PlanRow,
} from '../plan';
import { plainTextMarkdown } from '../writer/markdown';
import { PlanWriter, shortName } from '../writer/plan-writer';
import { readCsv } from './csv';
import { readAsanaCsv, type AsanaProject, type AsanaTask } from './read';

export const NOT_ASANA = "the file isn't an Asana project's CSV export";
/** Databases' longest option name. */
const OPTION_CHARS = 100;
/** Cells a record may have: far more than an export has, but few enough to hold in memory. */
const CSV_CELLS = 1_000;

/** A person cell lists its people with commas between them, so a name can't have one. */
const personName = (name: string) => name.replace(/\s*,\s*/g, ' ').trim();

/** `name`, or `name 2`, `name 3`... when another column already has it. */
function uniqueName(name: string, taken: Set<string>): string {
  let unique = name;
  for (let n = 2; taken.has(unique.toLowerCase()); n += 1) unique = `${name} ${n}`;
  taken.add(unique.toLowerCase());
  return unique;
}

/** The plan for a project that `readAsanaCsv` read from the file `fileName`. */
export function asanaPlan(project: AsanaProject, fileName: string): ImportPlan {
  const out = new PlanWriter(fileName);
  const { tasks } = project;
  if (tasks.length > IMPORT_LIMITS.rows) {
    throw new ImportFileError('databases can have up to 20,000 rows');
  }
  for (const { row, what, why } of project.problems) out.problem(`Row ${row}`, what, why);

  const keys = new Map(tasks.map((task) => [task, out.key('task')]));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const option = (name: string, what: string) => out.cut(name, OPTION_CHARS, what);
  const sections = new Map(
    project.sections.map((name) => [name, option(name, `Section "${shortName(name)}"`)]),
  );
  const tags = new Map<string, string>();
  for (const name of new Set(tasks.flatMap((task) => task.tags))) {
    tags.set(name, option(name, `Tag "${shortName(name)}"`));
  }

  const columns: { column: PlanColumn; cell: (task: AsanaTask) => string }[] = [
    { column: { name: 'Name', type: 'text' }, cell: (task) => task.name },
    {
      column: { name: 'Section', type: 'select' },
      cell: (task) => (task.section === null ? '' : (sections.get(task.section) ?? '')),
    },
    {
      column: { name: 'Assignee', type: 'person' },
      cell: (task) =>
        task.assignee ? (task.assignee.email ?? personName(task.assignee.name)) : '',
    },
    { column: { name: 'Start date', type: 'date' }, cell: (task) => task.start ?? '' },
    { column: { name: 'Due date', type: 'date' }, cell: (task) => task.due ?? '' },
    { column: { name: 'Completed', type: 'date' }, cell: (task) => task.completed ?? '' },
    {
      column: { name: 'Tags', type: 'multi_select' },
      cell: (task) => task.tags.map((tag) => tags.get(tag) ?? tag).join(', '),
    },
    {
      column: { name: 'Parent task', type: 'relation' },
      cell: (task) => {
        const parent = task.parentId === null ? undefined : byId.get(task.parentId);
        return parent ? (keys.get(parent) ?? '') : '';
      },
    },
    { column: { name: 'Blocked by', type: 'text' }, cell: (task) => task.blockedBy },
    { column: { name: 'Blocking', type: 'text' }, cell: (task) => task.blocking },
  ];
  // Name always; the others when a task has a value for them, then the project's own fields.
  const used = columns.filter((col, i) => i === 0 || tasks.some((task) => col.cell(task) !== ''));
  const taken = new Set(used.map(({ column }) => column.name.toLowerCase()));
  const fields = project.fields.filter((name) =>
    tasks.some((task) => Object.hasOwn(task.fields, name)),
  );
  const room = IMPORT_LIMITS.columns - used.length;
  if (fields.length > room) {
    const left = (fields.length - room).toLocaleString('en-US');
    const why = `Databases can have up to 200 columns, so the project's last ${left} weren't brought in.`;
    out.problem(null, 'Left out', why);
  }
  for (const field of fields.slice(0, Math.max(room, 0))) {
    const short = out.cut(field, IMPORT_LIMITS.columnNameChars, `Column "${shortName(field)}"`);
    const name = uniqueName(short, taken);
    const cell = (task: AsanaTask) =>
      Object.hasOwn(task.fields, field) ? (task.fields[field] ?? '') : '';
    used.push({ column: { name, type: null }, cell });
  }

  const rows = tasks.map((task): PlanRow => {
    const what = `Task "${shortName(task.name)}"`;
    const cells = used.map(({ column, cell }, i) =>
      i === 0
        ? out.text(cell(task), IMPORT_LIMITS.titleChars, what)
        : out.text(cell(task), IMPORT_LIMITS.cellChars, `${what}, ${column.name}`),
    );
    const row: PlanRow = { key: keys.get(task) ?? out.key('task'), cells };
    const markdown = plainTextMarkdown(task.notes);
    if (markdown) row.content = { markdown: out.text(markdown, IMPORT_LIMITS.pageChars, what) };
    if (task.created) row.created = task.created;
    if (task.updated) row.updated = task.updated;
    return row;
  });

  for (const { column } of used) out.spend(column.name.length);
  const title =
    fileName
      .replace(/^.*[\\/]/, '')
      .replace(/\.csv$/i, '')
      .trim() || 'Asana';
  out.plan.databases.push({
    key: out.key('project'),
    parent: null,
    title: out.text(title, IMPORT_LIMITS.titleChars, `Project "${shortName(title)}"`),
    columns: used.map(({ column }) => column),
    rows,
    source: fileName,
  });
  return out.done();
}

export const asanaImporter: Importer = {
  source: 'asana',
  async plan(input) {
    const records = readCsv(await input.text(), {
      records: IMPORT_LIMITS.rows + 1,
      cells: CSV_CELLS,
      cellChars: IMPORT_LIMITS.pageChars,
    });
    const project = readAsanaCsv(records);
    if (!project) throw new ImportFileError(NOT_ASANA);
    return asanaPlan(project, input.fileName);
  },
};
