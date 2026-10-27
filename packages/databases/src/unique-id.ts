/**
 * The ID property (additions 10; Databases 3.3): rows are numbered 1, 2, 3… in creation order, with
 * an optional prefix ("QA-12"). Numbers never change and are never reused after a delete, so the
 * server keeps the highest number ever given and passes it in.
 */
import { foldText } from './text';
import type { Id, Row } from './types';

/** A prefix as saved: trimmed, without trailing hyphens (shown with one); null when empty. */
export function normalizeIdPrefix(prefix: string | null | undefined): string | null {
  const p = (prefix ?? '').trim().replace(/-+$/, '').trim();
  return p === '' ? null : p;
}

/** How an ID shows: "QA-12" with a prefix, "12" without; '' for a row with no number. */
export function formatUniqueId(
  prefix: string | null | undefined,
  n: number | null | undefined,
): string {
  if (n === null || n === undefined) return '';
  return prefix ? `${prefix}-${n}` : String(n);
}

/** What search matches an ID by: "QA-12" (folded, as search compares) and "12". */
export function uniqueIdSearchKeys(prefix: string | null | undefined, n: number | null): string[] {
  if (n === null) return [];
  return [...new Set([foldText(formatUniqueId(prefix, n)), String(n)])];
}

const checkCount = (name: string, n: number) => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`${name} must be a whole number 0 or more`);
};

/**
 * The numbers for `count` new rows (in the order they're made, or file order for an import) after
 * the highest number ever given in the database: 5 → 6, 7, 8.
 */
export function nextUniqueNumbers(highest: number, count: number): number[] {
  checkCount('highest', highest);
  checkCount('count', count);
  return Array.from({ length: count }, (_, i) => highest + i + 1);
}

/** The highest number given so far: the one recorded (the delete-proof counter) or on the rows. */
export function highestUniqueNumber(
  rows: Iterable<Pick<Row, 'uniqueNumber'>>,
  recorded = 0,
): number {
  let highest = recorded;
  for (const row of rows) {
    if (row.uniqueNumber !== null && row.uniqueNumber > highest) highest = row.uniqueNumber;
  }
  return highest;
}

/**
 * Numbers for the rows that don't have one yet, when an ID property is added to a database that
 * has rows: oldest first (ties keep the given order), after `recorded` and every number in use.
 * Rows that have a number keep it. Row id → its new number.
 */
export function numberExistingRows(
  rows: readonly Pick<Row, 'id' | 'createdAt' | 'uniqueNumber'>[],
  recorded = 0,
): Map<Id, number> {
  const todo = rows
    .map((row, i) => ({ row, i, at: time(row.createdAt) }))
    .filter((r) => r.row.uniqueNumber === null)
    .sort((a, b) => a.at - b.at || a.i - b.i);
  const numbers = nextUniqueNumbers(highestUniqueNumber(rows, recorded), todo.length);
  return new Map(todo.map((r, k) => [r.row.id, numbers[k] ?? 0]));
}

/** A creation time to sort by; an unreadable one sorts last. */
function time(instant: string): number {
  const t = Date.parse(instant);
  return Number.isNaN(t) ? Infinity : t;
}
