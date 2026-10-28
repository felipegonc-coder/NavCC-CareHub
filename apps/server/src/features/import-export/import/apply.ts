import {
  IMPORT_LIMITS,
  ImportFileError,
  checkPlan,
  type ImportCounts,
  type ImportPlan,
  type ImportProblem,
  type ImportSourceId,
  type PlanContent,
  type PlanDates,
} from '@carehub/extras/import-export/import/index';
import { pageUrl } from '@carehub/shared';
import type { Tx } from '../../../db';
import { saveVersionNow } from '../../history';
import { databaseCells, rowLinks } from './cells';
import { prepareDoc, resolveMarkdown, type PlanTargets } from './content';
import { importedDates, usableTimeZone } from './dates';
import { importPorts, type ImportedDates, type ImportPorts } from './ports';
import type { ItemKind } from './schema';

/** Where an import goes: under a page, or at the top of a space (the person's Private space). */
export interface ImportTarget {
  workspaceId: string;
  pageId: string | null;
  spaceId: string | null;
}

export interface ApplyInput {
  userId: string;
  target: ImportTarget;
  /** Where the plan came from, for the pages' Updates ("Imported from Evernote"). */
  source: ImportSourceId;
  plan: ImportPlan;
  /** Each file's bytes, in the order of `plan.files`. */
  files: readonly Uint8Array[];
  /** Aborted on Cancel: the caller's transaction rolls back. */
  signal?: AbortSignal;
  /** Pages and databases written so far, of how many. */
  onProgress?: (done: number, total: number) => void;
}

/** A page, database or row the import made, under another one (`parentId`) or the target (null). */
export interface MadeItem {
  pageId: string;
  parentId: string | null;
  kind: ItemKind;
  title: string;
}

export interface ApplyResult {
  items: MadeItem[];
  counts: ImportCounts;
  /** The plan's problems and those found while writing it, at most IMPORT_LIMITS.problems. */
  problems: ImportProblem[];
  problemCount: number;
}

/** "files can't be imported yet" as a sentence. */
const sentence = (reason: string) => `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;

/** Fills a page; false when its document doesn't pass the page schema. */
async function fill(
  tx: Tx,
  ports: ImportPorts,
  page: { id: string; content: PlanContent },
  targets: PlanTargets,
  by: string,
): Promise<boolean> {
  if ('markdown' in page.content) {
    const markdown = resolveMarkdown(page.content.markdown, targets);
    if (markdown.trim() !== '') await ports.setMarkdown(tx, page.id, markdown, by);
    return true;
  }
  const doc = prepareDoc(page.content.doc, targets);
  if (doc) await ports.setDoc(tx, page.id, doc, by);
  return doc !== null;
}

/**
 * Writes a plan in the caller's transaction, so a rollback (Cancel, IE-11) leaves nothing behind:
 * a version of the page it goes under first (HT-02), then the files, the pages and databases
 * (every parent before what's under it) and last their content, once every link between them
 * can point at the new pages and files. Person cells are matched to members and relation cells
 * linked once their rows are made (cells.ts); the source's dates go in Updates (dates.ts).
 */
export async function applyPlan(tx: Tx, input: ApplyInput): Promise<ApplyResult> {
  const { userId: by, target, source, plan, signal } = input;
  const ports = importPorts();
  const order = checkPlan(plan);
  const problems = [...plan.problems];
  if (target.pageId) await saveVersionNow(tx, target.pageId, { reason: 'import', by });
  const timeZone = usableTimeZone(await ports.timeZoneOf(tx, by));
  const notes: ImportedDates[] = [];
  /** The source's dates for the page, for its Updates. */
  const note = (pageId: string, item: PlanDates) => {
    const dates = importedDates(item, timeZone);
    if (dates) notes.push({ pageId, source, ...dates, by });
  };

  const targets = new Map<string, string>();
  let files = 0;
  for (const [index, file] of plan.files.entries()) {
    signal?.throwIfAborted();
    const bytes = input.files[index];
    if (!bytes) throw new ImportFileError('the import is damaged');
    try {
      const saved = await ports.saveFile(tx, {
        workspaceId: target.workspaceId,
        name: file.name,
        bytes,
        by,
      });
      targets.set(file.key, saved.url);
      files += 1;
    } catch (error) {
      if (!(error instanceof ImportFileError)) throw error;
      problems.push({ file: file.name, what: 'Skipped', why: sentence(error.message) });
    }
  }

  // Two steps for each page (made, filled) and database (made with its rows), shown as pages.
  const total = plan.pages.length + plan.databases.length;
  let steps = 0;
  const step = (count = 1) => {
    steps += count;
    input.onProgress?.(Math.floor(steps / 2), total);
  };
  const idOf = new Map<string, string>();
  const made = (key: string, id: string) => {
    idOf.set(key, id);
    targets.set(key, pageUrl(id));
  };
  const under = (key: string | null) => {
    if (key === null) return null;
    const id = idOf.get(key);
    if (id === undefined) throw new ImportFileError('the import is damaged');
    return id;
  };
  const items: MadeItem[] = [];
  const toFill: { id: string; content: PlanContent; source: string; step: boolean }[] = [];
  let rows = 0;
  for (const item of order) {
    signal?.throwIfAborted();
    const parent = item.kind === 'page' ? item.page.parent : item.database.parent;
    const parentId = under(parent);
    const place = {
      workspaceId: target.workspaceId,
      spaceId: parentId === null && target.pageId === null ? target.spaceId : null,
      parentId: parentId ?? target.pageId,
      createdBy: by,
    };
    if (item.kind === 'page') {
      const { page } = item;
      const { id } = await ports.createPage(tx, { ...place, title: page.title });
      made(page.key, id);
      note(id, page);
      items.push({ pageId: id, parentId, kind: 'page', title: page.title });
      toFill.push({ id, content: page.content, source: page.source, step: true });
      step();
      continue;
    }
    const { database } = item;
    const cells = await databaseCells(tx, ports, target.workspaceId, database);
    problems.push(...cells.problems);
    const { id, rowIds } = await ports.createDatabase(tx, {
      ...place,
      title: database.title,
      columns: database.columns,
      rows: cells.rows,
      ...(database.view ? { view: database.view } : {}),
      timeZone,
    });
    if (rowIds.length !== database.rows.length) throw new Error('Not every row was made.');
    made(database.key, id);
    items.push({ pageId: id, parentId, kind: 'database', title: database.title });
    for (const [index, row] of database.rows.entries()) {
      const rowId = rowIds[index] as string;
      made(row.key, rowId);
      items.push({ pageId: rowId, parentId: id, kind: 'row', title: row.cells[0] ?? '' });
      note(rowId, row);
      if (row.content)
        toFill.push({ id: rowId, content: row.content, source: database.source, step: false });
    }
    const links = rowLinks(database, id, rowIds);
    for (const column of links.columns) await ports.linkRows(tx, column);
    if (links.missing > 0) {
      problems.push({
        file: database.source,
        what: 'Left out',
        why:
          links.missing === 1
            ? "A linked row isn't in the import."
            : `${links.missing} linked rows aren't in the import.`,
      });
    }
    rows += rowIds.length;
    step(2);
  }
  if (notes.length > 0) await ports.noteImported(tx, notes);

  for (const page of toFill) {
    signal?.throwIfAborted();
    if (!(await fill(tx, ports, page, targets, by))) {
      problems.push({
        file: page.source,
        what: 'Left empty',
        why: "Its content couldn't be read.",
      });
    }
    if (page.step) step();
  }
  return {
    items,
    counts: { pages: plan.pages.length, databases: plan.databases.length, rows, files },
    problems: problems.slice(0, IMPORT_LIMITS.problems),
    problemCount: problems.length,
  };
}
