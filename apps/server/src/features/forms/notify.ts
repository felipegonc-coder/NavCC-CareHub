// Notices about new responses (Forms spec, section 3: Notify). People on the form's notify list
// who can still view the database get the first response at once, with the new row as the card.
// Responses that follow within 5 minutes of each other are grouped into one notice (group key
// forms:<form id>), with the database as the card. Titles are generic, and nothing names the
// sender. For forms that record senders, people aren't told about their own response.
import { atLeast } from '@carehub/databases/access';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { sendNotice } from '../notices';
import { getAccessForPages } from '../pages';
import type { SavedResponse } from './submit';

const GROUP_MS = 5 * 60_000;
/** The most responses one grouped notice counts. */
const MOST_COUNTED = 100;

/**
 * How many responses, newest first, came each within 5 minutes of the one before. The first
 * response of such a run gets its own notice; the rest share the grouped one.
 */
export function runLength(newestFirst: readonly Date[]): number {
  let n = newestFirst.length > 0 ? 1 : 0;
  while (n < newestFirst.length) {
    const gap = newestFirst[n - 1]!.getTime() - newestFirst[n]!.getTime();
    if (gap >= GROUP_MS) break;
    n += 1;
  }
  return n;
}

/** "New response", "New anonymous response", or "3 new responses" for the grouped notice. */
export function noticeTitle(run: number, anonymous: boolean): string {
  if (run <= 2) return anonymous ? 'New anonymous response' : 'New response';
  return `${run - 1} new responses`;
}

const NOT_SENT = 'forms: a response notice was not sent';

/**
 * Sends the notices for a saved response, after its commit. Never throws (the response is saved
 * either way): a notice that fails is logged and skipped.
 */
export async function notifyResponse(app: FastifyInstance, saved: SavedResponse): Promise<void> {
  const people = [...new Set(saved.notifyUserIds)].filter((id) => id !== saved.senderId);
  if (people.length === 0) return;
  const run = await app.db
    .execute<{ created_at: Date | string }>(
      sql`
    SELECT created_at FROM db_rows
    WHERE database_id = ${saved.databaseId} AND form_view_id = ${saved.viewId}
    ORDER BY created_at DESC LIMIT ${MOST_COUNTED + 1}`,
    )
    .then(
      (recent) => runLength(recent.rows.map((row) => new Date(row.created_at))),
      (err: unknown) => {
        app.log.warn({ err }, NOT_SENT);
        return 0;
      },
    );
  if (run === 0) return;
  const first = run === 1;
  for (const userId of people) {
    try {
      const levels = await getAccessForPages(app.db, userId, [saved.databaseId]);
      if (!atLeast(levels.get(saved.databaseId), 'view')) continue;
      await sendNotice({
        workspaceId: saved.workspaceId,
        userId,
        kind: 'alert',
        sender: 'Forms',
        icon: '📝',
        title: noticeTitle(run, saved.anonymous),
        card: { type: 'page', pageId: first ? saved.rowId : saved.databaseId },
        ...(first ? {} : { groupKey: `forms:${saved.viewId}` }),
      });
    } catch (err) {
      app.log.warn({ err }, NOT_SENT);
    }
  }
}
