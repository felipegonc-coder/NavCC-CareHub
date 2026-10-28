import type { ImportView } from '@carehub/extras/import-export/import/index';

// Importing the same file into the same place again warns first (Import and export spec, 3.1):
// "You imported notion-export.zip into Support yesterday. Import again?"

const DAY_MS = 24 * 60 * 60 * 1000;
const midnight = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "today", "yesterday" or "on Oct 25", in the person's time zone. */
export function dayWords(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const days = Math.round((midnight(now) - midnight(then)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `on ${then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export interface SameImport {
  fileName: string;
  size: number;
  pageId: string | null;
}

/** The person's latest finished import of this file into this place, if any (newest first). */
export function earlierImport(
  imports: readonly ImportView[],
  { fileName, size, pageId }: SameImport,
): ImportView | undefined {
  return imports.find(
    (view) =>
      view.status === 'done' &&
      view.fileName === fileName &&
      view.size === size &&
      view.destination.pageId === pageId,
  );
}

/** "You imported notion-export.zip into Support yesterday." */
export function earlierWords(view: ImportView, now?: Date): string {
  const when = dayWords(view.finishedAt ?? view.createdAt, now);
  return `You imported ${view.fileName} into ${view.destination.title} ${when}.`;
}
