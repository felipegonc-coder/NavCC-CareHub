import { UNDO_DAYS, type ImportView } from '@carehub/extras/import-export/import/index';
import type { ImportRow } from './store';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Undo import is there for 7 days after an import is done (not after Undo). */
export function canUndo(row: Pick<ImportRow, 'status' | 'finishedAt'>, now: Date): boolean {
  if (row.status !== 'done' || row.finishedAt === null) return false;
  return now.getTime() - row.finishedAt.getTime() < UNDO_DAYS * DAY_MS;
}

export interface ViewDetails {
  /** Where it went, as the person sees it: the page's title, or "Private". */
  title: string;
  /** The job's progress while it runs. */
  progress: { done: number; total: number } | null;
  /** False for lists, which leave out the problem list (problemCount stays). */
  problems?: boolean;
  now?: Date;
}

/** An import as its maker sees it (ImportView). */
export function importView(row: ImportRow, details: ViewDetails): ImportView {
  return {
    id: row.id,
    source: row.source,
    fileName: row.fileName,
    size: row.fileSize,
    status: row.status,
    destination: { pageId: row.pageId, title: details.title },
    progress: row.status === 'running' ? details.progress : null,
    counts: row.counts ?? null,
    problems: details.problems === false ? [] : row.problems,
    problemCount: row.problemCount,
    error: row.error,
    canUndo: canUndo(row, details.now ?? new Date()),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
