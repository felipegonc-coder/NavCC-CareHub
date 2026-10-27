// GET /:id/rows/pick?q= (decision 0200, W2-3): rows for relation pickers, 20 at a time, only ones
// the viewer can open: { id, title, icon }. The search matches titles as toolbar search does (every
// word, ignoring case and accents). Titles that start with the search come first, then A to Z.
import type { Id } from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import { searchWords } from '@carehub/databases/search';
import { foldText } from '@carehub/databases/text';
import { sql } from 'drizzle-orm';
import { iconText, isUuid } from './record';
import { accessLevels } from './row-cache';
import type { Executor } from './store';

/** Rows one answer lists. */
export const PICK_ROWS = 20;
/** Rows whose access is looked up at once, at first; each further lookup takes four times more. */
const FIRST_LOOKUP = 100;
const MOST_LOOKUP = 5_000;

/** A row as a relation picker lists it. */
export interface RowPick {
  id: Id;
  title: string;
  /** The emoji, or null for none or another kind of icon. */
  icon: string | null;
}

export interface PickInput {
  databaseId: string;
  userId: string;
  /** What the picker's search box says; blank lists every row. */
  q?: string | null;
}

/** Up to PICK_ROWS rows of the database the person can open, best matches first. */
export async function pickRows(db: Executor, input: PickInput): Promise<RowPick[]> {
  if (!isUuid(input.databaseId)) return [];
  const { rows } = await db.execute<{ id: string; title: string | null; icon: unknown }>(sql`
    SELECT r.page_id AS id, p.title, p.icon
    FROM db_rows r JOIN pages p ON p.id = r.page_id
    WHERE r.database_id = ${input.databaseId} AND p.deleted_at IS NULL
    ORDER BY lower(p.title), r.page_id`);
  const words = searchWords(input.q ?? '');
  const start = words.join(' ');
  const first: RowPick[] = [];
  const rest: RowPick[] = [];
  for (const r of rows) {
    const title = r.title ?? '';
    const folded = foldText(title);
    if (!words.every((w) => folded.includes(w))) continue;
    const pick = { id: r.id, title, icon: iconText(r.icon) };
    (start && folded.startsWith(start) ? first : rest).push(pick);
  }
  const candidates = [...first, ...rest];
  const picked: RowPick[] = [];
  let at = 0;
  for (let size = FIRST_LOOKUP; at < candidates.length && picked.length < PICK_ROWS;) {
    const part = candidates.slice(at, at + size);
    at += part.length;
    size = Math.min(size * 4, MOST_LOOKUP);
    const levels = await accessLevels(
      db,
      input.userId,
      part.map((c) => c.id),
    );
    for (const c of part) {
      if (picked.length < PICK_ROWS && atLeast(levels.get(c.id), 'view')) picked.push(c);
    }
  }
  return picked;
}
